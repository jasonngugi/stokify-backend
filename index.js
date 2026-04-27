const express = require('express');
const cors = require('cors');
require('dotenv').config();
const supabase = require('./supabase');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Inventory app backend is running! v2' });
});

app.post('/products', async (req, res) => {
  const { store_id, name, sku, quantity, low_stock_threshold, price, buying_price, supplier_id, category_id, expiry_date } = req.body;
  const { data, error } = await supabase
    .from('products')
    .insert([{ store_id, name, sku, quantity, low_stock_threshold, price, buying_price, supplier_id, category_id, expiry_date }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ product: data[0] });
});

app.get('/products/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('products')
    .select('*, suppliers(name), categories(name)')
    .eq('store_id', store_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ products: data });
});

app.patch('/products/:id', async (req, res) => {
  const { id } = req.params;
  const { quantity, price, low_stock_threshold } = req.body;
  const { data, error } = await supabase
    .from('products')
    .update({ quantity, price, low_stock_threshold })
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ product: data[0] });
});

app.delete('/products/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Product deleted successfully' });
});

app.post('/sales', async (req, res) => {
  const { store_id, items } = req.body;

  // Check stock levels before processing sale
  for (const item of items) {
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('quantity, name')
      .eq('id', item.product_id)
      .single();
    
    if (productError) return res.status(400).json({ error: productError.message });
    
    if (product.quantity < item.quantity) {
      return res.status(400).json({ 
        error: `Not enough stock for ${product.name}. Available: ${product.quantity}, Requested: ${item.quantity}` 
      });
    }
  }

  const total_amount = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert([{ store_id, total_amount }])
    .select();
  if (saleError) return res.status(400).json({ error: saleError.message });
  
  const saleItems = items.map(item => ({
    sale_id: sale[0].id,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price
  }));
  
  const { error: itemsError } = await supabase
    .from('sale_items')
    .insert(saleItems);
  if (itemsError) return res.status(400).json({ error: itemsError.message });
  
  for (const item of items) {
    await supabase.rpc('decrement_stock', {
      p_product_id: item.product_id,
      p_quantity: item.quantity
    });
  }
  res.status(201).json({ sale: sale[0], total_amount });
});

app.get('/sales/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('sales')
    .select(`
      id,
      total_amount,
      sold_at,
      sale_items (
        quantity,
        unit_price,
        products (
          name
        )
      )
    `)
    .eq('store_id', store_id)
    .order('sold_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ sales: data });
});

app.post('/suppliers', async (req, res) => {
  const { store_id, name, contact_email, phone } = req.body;
  const { data, error } = await supabase
    .from('suppliers')
    .insert([{ store_id, name, contact_email, phone }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ supplier: data[0] });
});

app.get('/suppliers/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('store_id', store_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ suppliers: data });
});

app.delete('/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('suppliers')
    .delete()
    .eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Supplier deleted successfully' });
});


app.post('/stores', async (req, res) => {
  const { name, user_id } = req.body;
  const { data, error } = await supabase
    .from('stores')
    .insert([{ name }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  
  const store = data[0];
  
  const { error: userError } = await supabase
    .from('users')
    .insert([{ store_id: store.id, name: name, email: '', role: 'owner', id: user_id }]);
  
  res.status(201).json({ store });
});

app.get('/stores/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .select('store_id, stores(*)')
    .eq('id', user_id)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ store: data.stores, store_id: data.store_id });
});


app.post('/categories', async (req, res) => {
  const { store_id, name } = req.body;
  const { data, error } = await supabase
    .from('categories')
    .insert([{ store_id, name }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ category: data[0] });
});

app.get('/categories/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('store_id', store_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ categories: data });
});

app.delete('/categories/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Category deleted successfully' });
});


app.get('/reorder/:store_id', async (req, res) => {
  const { store_id } = req.params;

  // Get all products with low stock
  const { data: allProducts, error: productsError } = await supabase
    .from('products')
    .select('*, suppliers(name, phone, contact_email), categories(name)')
    .eq('store_id', store_id);

  if (productsError) return res.status(400).json({ error: productsError.message });

  const products = allProducts.filter(p => p.quantity <= p.low_stock_threshold);
  if (productsError) return res.status(400).json({ error: productsError.message });

  // Get sales from last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: salesData, error: salesError } = await supabase
    .from('sale_items')
    .select('product_id, quantity, sales(sold_at)')
    .gte('sales.sold_at', thirtyDaysAgo.toISOString());

  if (salesError) return res.status(400).json({ error: salesError.message });

  // Calculate reorder suggestions
  const reorderSuggestions = products.map(product => {
    const productSales = salesData.filter(s => s.product_id === product.id);
    const totalSold = productSales.reduce((sum, s) => sum + s.quantity, 0);
    const avgDailySales = totalSold / 30;
    const suggestedQuantity = Math.ceil(avgDailySales * 30) || 20;
    const estimatedCost = suggestedQuantity * (product.buying_price || 0);

    return {
      id: product.id,
      name: product.name,
      current_stock: product.quantity,
      low_stock_threshold: product.low_stock_threshold,
      avg_daily_sales: avgDailySales.toFixed(1),
      suggested_quantity: suggestedQuantity,
      estimated_cost: estimatedCost,
      buying_price: product.buying_price,
      supplier: product.suppliers,
      category: product.categories?.name
    };
  });

  res.json({ reorder_suggestions: reorderSuggestions });
});


app.get('/expiry/:store_id', async (req, res) => {
  const { store_id } = req.params;
  
  const today = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const { data, error } = await supabase
    .from('products')
    .select('*, categories(name)')
    .eq('store_id', store_id)
    .not('expiry_date', 'is', null)
    .lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0])
    .order('expiry_date', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });

  const products = data.map(p => {
    const expiry = new Date(p.expiry_date);
    const daysUntilExpiry = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    return { ...p, days_until_expiry: daysUntilExpiry };
  });

  res.json({ expiring_products: products });
});


app.get('/slowmoving/:store_id', async (req, res) => {
  const { store_id } = req.params;
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('*, categories(name)')
    .eq('store_id', store_id)
    .gt('quantity', 0);

  if (productsError) return res.status(400).json({ error: productsError.message });

  const { data: recentSales, error: salesError } = await supabase
    .from('sale_items')
    .select('product_id, quantity, sales(sold_at)')
    .gte('sales.sold_at', thirtyDaysAgo.toISOString());

  if (salesError) return res.status(400).json({ error: salesError.message });

  const soldProductIds = new Set(recentSales.map(s => s.product_id));

  const slowMoving = products
    .filter(p => !soldProductIds.has(p.id))
    .map(p => ({
      id: p.id,
      name: p.name,
      quantity: p.quantity,
      price: p.price,
      buying_price: p.buying_price,
      category: p.categories?.name || 'Uncategorised',
      stock_value: p.quantity * p.buying_price,
      potential_revenue: p.quantity * p.price
    }));

  res.json({ slow_moving_products: slowMoving });
});

app.get('/seasonal/:store_id', async (req, res) => {
  const { store_id } = req.params;

  const now = new Date();
  
  // Get sales for last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const { data: sales, error } = await supabase
    .from('sales')
    .select('total_amount, sold_at')
    .eq('store_id', store_id)
    .gte('sold_at', sixMonthsAgo.toISOString())
    .order('sold_at', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });

  // Group by month
  const monthlyData = {};
  sales.forEach(sale => {
    const date = new Date(sale.sold_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = date.toLocaleDateString('en-KE', { month: 'short', year: 'numeric' });
    if (!monthlyData[key]) monthlyData[key] = { month: label, revenue: 0, transactions: 0 };
    monthlyData[key].revenue += sale.total_amount;
    monthlyData[key].transactions += 1;
  });

  const monthly = Object.values(monthlyData);

  // This month vs last month
  const thisMonth = monthly[monthly.length - 1] || { revenue: 0, transactions: 0 };
  const lastMonth = monthly[monthly.length - 2] || { revenue: 0, transactions: 0 };
  const revenueChange = lastMonth.revenue > 0 
    ? (((thisMonth.revenue - lastMonth.revenue) / lastMonth.revenue) * 100).toFixed(1)
    : 0;

  res.json({ 
    monthly,
    thisMonth,
    lastMonth,
    revenueChange
  });
});

app.get('/daily-summary/:store_id', async (req, res) => {
  const { store_id } = req.params;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Today's sales
  const { data: todaySales, error: todayError } = await supabase
    .from('sales')
    .select(`
      id, total_amount, sold_at,
      sale_items (
        quantity, unit_price,
        products ( name, buying_price )
      )
    `)
    .eq('store_id', store_id)
    .gte('sold_at', today.toISOString())
    .lt('sold_at', tomorrow.toISOString());

  if (todayError) return res.status(400).json({ error: todayError.message });

  // Yesterday's sales
  const { data: yesterdaySales, error: yesterdayError } = await supabase
    .from('sales')
    .select('total_amount')
    .eq('store_id', store_id)
    .gte('sold_at', yesterday.toISOString())
    .lt('sold_at', today.toISOString());

  if (yesterdayError) return res.status(400).json({ error: yesterdayError.message });

  // Calculate today's stats
  const totalRevenue = todaySales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalTransactions = todaySales.length;

  // Calculate profit
  let totalCost = 0;
  const productSales = {};

  todaySales.forEach(sale => {
    sale.sale_items?.forEach(item => {
      const cost = (item.products?.buying_price || 0) * item.quantity;
      totalCost += cost;
      const name = item.products?.name || 'Unknown';
      if (!productSales[name]) productSales[name] = { quantity: 0, revenue: 0 };
      productSales[name].quantity += item.quantity;
      productSales[name].revenue += item.quantity * item.unit_price;
    });
  });

  const totalProfit = totalRevenue - totalCost;

  // Top products
  const topProducts = Object.entries(productSales)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3);

  // Hourly breakdown
  const hourlyData = {};
  todaySales.forEach(sale => {
    const hour = new Date(sale.sold_at).getHours();
    const label = `${hour}:00`;
    if (!hourlyData[label]) hourlyData[label] = { hour: label, revenue: 0, transactions: 0 };
    hourlyData[label].revenue += sale.total_amount;
    hourlyData[label].transactions += 1;
  });

  const hourly = Object.values(hourlyData).sort((a, b) => 
    parseInt(a.hour) - parseInt(b.hour)
  );

  // Yesterday comparison
  const yesterdayRevenue = yesterdaySales.reduce((sum, s) => sum + s.total_amount, 0);
  const revenueChange = yesterdayRevenue > 0
    ? (((totalRevenue - yesterdayRevenue) / yesterdayRevenue) * 100).toFixed(1)
    : 0;

  res.json({
    date: today.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    totalRevenue,
    totalProfit,
    totalCost,
    totalTransactions,
    topProducts,
    hourly,
    yesterdayRevenue,
    revenueChange
  });
});


app.get('/weekly-summary/:store_id', async (req, res) => {
  const { store_id } = req.params;

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  weekAgo.setHours(0, 0, 0, 0);

  const { data: sales, error } = await supabase
    .from('sales')
    .select(`
      id, total_amount, sold_at,
      sale_items (
        quantity, unit_price,
        products ( name, buying_price )
      )
    `)
    .eq('store_id', store_id)
    .gte('sold_at', weekAgo.toISOString())
    .lte('sold_at', today.toISOString())
    .order('sold_at', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });

  const totalRevenue = sales.reduce((sum, s) => sum + s.total_amount, 0);
  let totalCost = 0;
  const productSales = {};
  const dailyData = {};

  sales.forEach(sale => {
    const day = new Date(sale.sold_at).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!dailyData[day]) dailyData[day] = { day, revenue: 0, transactions: 0 };
    dailyData[day].revenue += sale.total_amount;
    dailyData[day].transactions += 1;

    sale.sale_items?.forEach(item => {
      const cost = (item.products?.buying_price || 0) * item.quantity;
      totalCost += cost;
      const name = item.products?.name || 'Unknown';
      if (!productSales[name]) productSales[name] = { quantity: 0, revenue: 0 };
      productSales[name].quantity += item.quantity;
      productSales[name].revenue += item.quantity * item.unit_price;
    });
  });

  const totalProfit = totalRevenue - totalCost;
  const topProducts = Object.entries(productSales)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const daily = Object.values(dailyData);
  const bestDay = daily.sort((a, b) => b.revenue - a.revenue)[0];

  res.json({
    period: `${weekAgo.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })} - ${today.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    totalRevenue,
    totalCost,
    totalProfit,
    totalTransactions: sales.length,
    topProducts,
    daily: Object.values(dailyData),
    bestDay
  });
});

app.get('/monthly-summary/:store_id', async (req, res) => {
  const { store_id } = req.params;

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  monthAgo.setHours(0, 0, 0, 0);

  const { data: sales, error } = await supabase
    .from('sales')
    .select(`
      id, total_amount, sold_at,
      sale_items (
        quantity, unit_price,
        products ( name, buying_price )
      )
    `)
    .eq('store_id', store_id)
    .gte('sold_at', monthAgo.toISOString())
    .lte('sold_at', today.toISOString())
    .order('sold_at', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });

  const totalRevenue = sales.reduce((sum, s) => sum + s.total_amount, 0);
  let totalCost = 0;
  const productSales = {};
  const weeklyData = {};

  sales.forEach(sale => {
    const date = new Date(sale.sold_at);
    const weekNum = Math.floor((date - monthAgo) / (7 * 24 * 60 * 60 * 1000)) + 1;
    const weekLabel = `Week ${weekNum}`;
    if (!weeklyData[weekLabel]) weeklyData[weekLabel] = { week: weekLabel, revenue: 0, transactions: 0 };
    weeklyData[weekLabel].revenue += sale.total_amount;
    weeklyData[weekLabel].transactions += 1;

    sale.sale_items?.forEach(item => {
      const cost = (item.products?.buying_price || 0) * item.quantity;
      totalCost += cost;
      const name = item.products?.name || 'Unknown';
      if (!productSales[name]) productSales[name] = { quantity: 0, revenue: 0 };
      productSales[name].quantity += item.quantity;
      productSales[name].revenue += item.quantity * item.unit_price;
    });
  });

  const totalProfit = totalRevenue - totalCost;
  const topProducts = Object.entries(productSales)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  res.json({
    period: `${monthAgo.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })} - ${today.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    totalRevenue,
    totalCost,
    totalProfit,
    totalTransactions: sales.length,
    topProducts,
    weekly: Object.values(weeklyData),
    avgDailyRevenue: (totalRevenue / 30).toFixed(0)
  });
});

app.post('/expenses', async (req, res) => {
  const { store_id, name, amount, category, date, is_recurring } = req.body;
  const { data, error } = await supabase
    .from('expenses')
    .insert([{ store_id, name, amount, category, date, is_recurring }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ expense: data[0] });
});

app.get('/expenses/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('store_id', store_id)
    .order('date', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ expenses: data });
});

app.delete('/expenses/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Expense deleted successfully' });
});

app.get('/breakeven/:store_id', async (req, res) => {
  const { store_id } = req.params;

  // Get all recurring expenses (fixed costs)
  const { data: expenses, error: expensesError } = await supabase
    .from('expenses')
    .select('*')
    .eq('store_id', store_id)
    .eq('is_recurring', true);

  if (expensesError) return res.status(400).json({ error: expensesError.message });

  // Get products to calculate average margin
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('price, buying_price')
    .eq('store_id', store_id)
    .gt('buying_price', 0);

  if (productsError) return res.status(400).json({ error: productsError.message });

  const totalFixedCosts = expenses.reduce((sum, e) => sum + e.amount, 0);
  
  const avgMargin = products.length > 0
    ? products.reduce((sum, p) => sum + ((p.price - p.buying_price) / p.price), 0) / products.length
    : 0;

  const breakEvenRevenue = avgMargin > 0 ? totalFixedCosts / avgMargin : 0;
  const breakEvenDaily = breakEvenRevenue / 30;

  res.json({
    totalFixedCosts,
    avgMarginPercent: (avgMargin * 100).toFixed(1),
    breakEvenRevenue,
    breakEvenDaily,
    expenses
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});