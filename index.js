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

app.get('/debug/tables', async (req, res) => {
  const { data, error } = await supabase
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public');
  res.json({ tables: data, error: error?.message });
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
  const { name, sku, quantity, price, buying_price, low_stock_threshold, supplier_id, category_id, expiry_date, old_quantity, reason, store_id } = req.body;

  const { data, error } = await supabase
    .from('products')
    .update({ name, sku, quantity, price, buying_price, low_stock_threshold, supplier_id, category_id, expiry_date })
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });

  if (old_quantity !== undefined && quantity !== undefined && old_quantity !== quantity) {
    await supabase
      .from('stock_adjustments')
      .insert([{ store_id, product_id: id, old_quantity, new_quantity: quantity, reason }]);
  }

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
  const { store_id, items, payment_method = 'cash', customer_id } = req.body;

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
    .insert([{ store_id, total_amount, payment_method, customer_id }])
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
      id, total_amount, sold_at,
      sale_items (
        quantity, unit_price,
        products ( name )
      )
    `)
    .eq('store_id', store_id)
    .order('sold_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ sales: data });
});

app.post('/suppliers', async (req, res) => {
  const { store_id, name, contact_email, phone, lead_time_days } = req.body;
  const { data, error } = await supabase
    .from('suppliers')
    .insert([{ store_id, name, contact_email, phone, lead_time_days: lead_time_days || 3 }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ supplier: data[0] });
});

app.patch('/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  const { name, contact_email, phone, lead_time_days } = req.body;
  const { data, error } = await supabase
    .from('suppliers')
    .update({ name, contact_email, phone, lead_time_days })
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ supplier: data[0] });
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
  console.log('POST /stores called with body:', req.body);
  const { name, user_id, business_type = 'general' } = req.body;

  if (!name || !user_id) {
    console.log('Missing name or user_id');
    return res.status(400).json({ error: 'Store name and user ID are required' });
  }

  // Check if user already has a store
  const { data: existingUser } = await supabase
    .from('users')
    .select('store_id, stores(*)')
    .eq('id', user_id)
    .single();

  if (existingUser) {
    console.log('User already has a store, returning existing store');
    return res.status(201).json({ store: existingUser.stores });
  }

  // Create the store
  const { data: storeData, error: storeError } = await supabase
    .from('stores')
    .insert([{ name, business_type }])
    .select();
  if (storeError) {
    console.log('Store creation error:', storeError.message);
    return res.status(400).json({ error: storeError.message });
  }

  const store = storeData[0];

  // Create the user record linked to the store
  const { error: userError } = await supabase
    .from('users')
    .insert([{
      id: user_id,
      store_id: store.id,
      name: name,
      email: '',
      role: 'owner'
    }]);

  if (userError) {
    console.log('User creation error:', userError.message);
    return res.status(400).json({ error: userError.message });
  }

  console.log('Store created successfully:', store.id);
  res.status(201).json({ store });
});

app.get('/stores/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .select('store_id, role, stores!users_store_id_fkey(*)')
    .eq('id', user_id)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({
    store: data.stores,
    store_id: data.store_id,
    role: data.role,
    business_type: data.stores?.business_type
  });
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

  const { data: storeData } = await supabase
    .from('stores')
    .select('business_type')
    .eq('id', store_id)
    .single();

  const businessType = storeData?.business_type || 'general';

  const { data: allProducts, error: productsError } = await supabase
    .from('products')
    .select('*, suppliers(name, phone, contact_email), categories(name)')
    .eq('store_id', store_id);

  if (productsError) return res.status(400).json({ error: productsError.message });

  const products = allProducts.filter(p => p.quantity <= p.low_stock_threshold);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: salesData, error: salesError } = await supabase
    .from('sale_items')
    .select('product_id, quantity, sales(sold_at)')
    .gte('sales.sold_at', thirtyDaysAgo.toISOString());

  if (salesError) return res.status(400).json({ error: salesError.message });

  // Business type settings
  const businessSettings = {
    general:     { cycleDays: 30, safetyMultiplier: 1.2 },
    restaurant:  { cycleDays: 7,  safetyMultiplier: 1.5 },
    pharmacy:    { cycleDays: 14, safetyMultiplier: 1.3 },
    clothing:    { cycleDays: 60, safetyMultiplier: 1.1 },
    electronics: { cycleDays: 60, safetyMultiplier: 1.1 },
    hardware:    { cycleDays: 45, safetyMultiplier: 1.2 },
    agrovet:     { cycleDays: 30, safetyMultiplier: 1.3 },
    cosmetics:   { cycleDays: 30, safetyMultiplier: 1.2 },
    supermarket: { cycleDays: 14, safetyMultiplier: 1.4 },
    other:       { cycleDays: 30, safetyMultiplier: 1.2 },
  };

  const settings = businessSettings[businessType] || businessSettings.general;

  const reorderSuggestions = products.map(product => {
    const productSales = salesData.filter(s => s.product_id === product.id);
    const totalSold = productSales.reduce((sum, s) => sum + s.quantity, 0);
    const avgDailySales = totalSold / 30;

    // Smart reorder quantity based on business type
    const baseSuggested = Math.ceil(avgDailySales * settings.cycleDays);
    const suggestedQuantity = Math.max(
      Math.ceil(baseSuggested * settings.safetyMultiplier),
      product.low_stock_threshold * 2,
      20
    );

    const estimatedCost = suggestedQuantity * (product.buying_price || 0);
    const daysOfStockLeft = avgDailySales > 0 ? Math.floor(product.quantity / avgDailySales) : null;
    const urgency = daysOfStockLeft !== null && daysOfStockLeft <= 3 ? 'critical' :
                    daysOfStockLeft !== null && daysOfStockLeft <= 7 ? 'high' : 'normal';

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
      category: product.categories?.name,
      days_of_stock_left: daysOfStockLeft,
      urgency,
      cycle_days: settings.cycleDays,
    };
  });

  // Sort by urgency
  const urgencyOrder = { critical: 0, high: 1, normal: 2 };
  reorderSuggestions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  res.json({ reorder_suggestions: reorderSuggestions, business_type: businessType });
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
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const { data: sales, error } = await supabase
    .from('sales')
    .select('total_amount, sold_at')
    .eq('store_id', store_id)
    .gte('sold_at', sixMonthsAgo.toISOString())
    .order('sold_at', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
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
  const thisMonth = monthly[monthly.length - 1] || { revenue: 0, transactions: 0 };
  const lastMonth = monthly[monthly.length - 2] || { revenue: 0, transactions: 0 };
  const revenueChange = lastMonth.revenue > 0
    ? (((thisMonth.revenue - lastMonth.revenue) / lastMonth.revenue) * 100).toFixed(1)
    : 0;
  res.json({ monthly, thisMonth, lastMonth, revenueChange });
});

app.get('/daily-summary/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const { data: todaySales, error: todayError } = await supabase
    .from('sales')
    .select(`id, total_amount, sold_at, sale_items (quantity, unit_price, products ( name, buying_price ))`)
    .eq('store_id', store_id)
    .gte('sold_at', today.toISOString())
    .lt('sold_at', tomorrow.toISOString());
  if (todayError) return res.status(400).json({ error: todayError.message });
  const { data: yesterdaySales, error: yesterdayError } = await supabase
    .from('sales')
    .select('total_amount')
    .eq('store_id', store_id)
    .gte('sold_at', yesterday.toISOString())
    .lt('sold_at', today.toISOString());
  if (yesterdayError) return res.status(400).json({ error: yesterdayError.message });
  const totalRevenue = todaySales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalTransactions = todaySales.length;
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
  const topProducts = Object.entries(productSales)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3);
  const hourlyData = {};
  todaySales.forEach(sale => {
    const hour = new Date(sale.sold_at).getHours();
    const label = `${hour}:00`;
    if (!hourlyData[label]) hourlyData[label] = { hour: label, revenue: 0, transactions: 0 };
    hourlyData[label].revenue += sale.total_amount;
    hourlyData[label].transactions += 1;
  });
  const hourly = Object.values(hourlyData).sort((a, b) => parseInt(a.hour) - parseInt(b.hour));
  const yesterdayRevenue = yesterdaySales.reduce((sum, s) => sum + s.total_amount, 0);
  const revenueChange = yesterdayRevenue > 0
    ? (((totalRevenue - yesterdayRevenue) / yesterdayRevenue) * 100).toFixed(1)
    : 0;
  res.json({
    date: today.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    totalRevenue, totalProfit, totalCost, totalTransactions, topProducts, hourly, yesterdayRevenue, revenueChange
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
    .select(`id, total_amount, sold_at, sale_items (quantity, unit_price, products ( name, buying_price ))`)
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
  const bestDay = [...daily].sort((a, b) => b.revenue - a.revenue)[0];
  res.json({
    period: `${weekAgo.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })} - ${today.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    totalRevenue, totalCost, totalProfit, totalTransactions: sales.length, topProducts, daily, bestDay
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
    .select(`id, total_amount, sold_at, sale_items (quantity, unit_price, products ( name, buying_price ))`)
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
    totalRevenue, totalCost, totalProfit, totalTransactions: sales.length,
    topProducts, weekly: Object.values(weeklyData), avgDailyRevenue: (totalRevenue / 30).toFixed(0)
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
  const { data: expenses, error: expensesError } = await supabase
    .from('expenses')
    .select('*')
    .eq('store_id', store_id)
    .eq('is_recurring', true);
  if (expensesError) return res.status(400).json({ error: expensesError.message });
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
  res.json({ totalFixedCosts, avgMarginPercent: (avgMargin * 100).toFixed(1), breakEvenRevenue, breakEvenDaily, expenses });
});

app.get('/cashflow/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('total_amount, sold_at')
    .eq('store_id', store_id)
    .gte('sold_at', sixMonthsAgo.toISOString())
    .order('sold_at', { ascending: true });
  if (salesError) return res.status(400).json({ error: salesError.message });
  const { data: expenses, error: expensesError } = await supabase
    .from('expenses')
    .select('amount, date, name, category')
    .eq('store_id', store_id)
    .gte('date', sixMonthsAgo.toISOString().split('T')[0])
    .order('date', { ascending: true });
  if (expensesError) return res.status(400).json({ error: expensesError.message });
  const monthlyData = {};
  sales.forEach(sale => {
    const date = new Date(sale.sold_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = date.toLocaleDateString('en-KE', { month: 'short', year: 'numeric' });
    if (!monthlyData[key]) monthlyData[key] = { month: label, revenue: 0, expenses: 0, net: 0 };
    monthlyData[key].revenue += sale.total_amount;
  });
  expenses.forEach(expense => {
    const date = new Date(expense.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = date.toLocaleDateString('en-KE', { month: 'short', year: 'numeric' });
    if (!monthlyData[key]) monthlyData[key] = { month: label, revenue: 0, expenses: 0, net: 0 };
    monthlyData[key].expenses += expense.amount;
  });
  Object.values(monthlyData).forEach(m => { m.net = m.revenue - m.expenses; });
  const monthly = Object.values(monthlyData).sort((a, b) => new Date('01 ' + a.month) - new Date('01 ' + b.month));
  const totalRevenue = monthly.reduce((sum, m) => sum + m.revenue, 0);
  const totalExpenses = monthly.reduce((sum, m) => sum + m.expenses, 0);
  const netCashFlow = totalRevenue - totalExpenses;
  res.json({ monthly, totalRevenue, totalExpenses, netCashFlow, recentExpenses: expenses.slice(0, 5) });
});


app.get('/credit/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('sales')
    .select(`
      id, total_amount, sold_at, payment_method,
      customers(id, name, phone),
      sale_items(quantity, unit_price, products(name))
    `)
    .eq('store_id', store_id)
    .eq('payment_method', 'credit')
    .order('sold_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ credit_sales: data });
});

app.patch('/sales/:id/payment', async (req, res) => {
  const { id } = req.params;
  const { payment_method } = req.body;
  const { data, error } = await supabase
    .from('sales')
    .update({ payment_method })
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ sale: data[0] });
});

app.get('/staff/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('store_id', store_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ staff: data });
});

app.patch('/staff/:user_id/role', async (req, res) => {
  const { user_id } = req.params;
  const { role } = req.body;
  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', user_id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ user: data[0] });
});

app.delete('/staff/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', user_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Staff member removed successfully' });
});

app.get('/ai-context/:store_id', async (req, res) => {
  const { store_id } = req.params;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [products, sales, expenses, creditSales] = await Promise.all([
    supabase.from('products').select('*, categories(name)').eq('store_id', store_id),
    supabase.from('sales').select(`total_amount, sold_at, payment_method, sale_items(quantity, unit_price, products(name, buying_price))`).eq('store_id', store_id).gte('sold_at', thirtyDaysAgo.toISOString()),
    supabase.from('expenses').select('*').eq('store_id', store_id).gte('date', thirtyDaysAgo.toISOString().split('T')[0]),
    supabase.from('sales').select('total_amount, customers(name)').eq('store_id', store_id).eq('payment_method', 'credit')
  ]);

  const totalRevenue = sales.data?.reduce((sum, s) => sum + s.total_amount, 0) || 0;
  const totalExpenses = expenses.data?.reduce((sum, e) => sum + e.amount, 0) || 0;
  const totalCost = sales.data?.reduce((sum, s) => sum + (s.sale_items?.reduce((a, i) => a + (i.products?.buying_price || 0) * i.quantity, 0) || 0), 0) || 0;
  const totalProfit = totalRevenue - totalCost;
  const totalCredit = creditSales.data?.reduce((sum, s) => sum + s.total_amount, 0) || 0;

  const productSales = {};
  sales.data?.forEach(sale => {
    sale.sale_items?.forEach(item => {
      const name = item.products?.name || 'Unknown';
      if (!productSales[name]) productSales[name] = 0;
      productSales[name] += item.quantity;
    });
  });

  const topProducts = Object.entries(productSales)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }));

  const lowStock = products.data?.filter(p => p.quantity <= p.low_stock_threshold) || [];

  res.json({
    summary: {
      totalRevenue,
      totalExpenses,
      totalProfit,
      totalCredit,
      totalTransactions: sales.data?.length || 0,
      products: products.data?.length || 0,
      lowStockCount: lowStock.length,
      lowStockItems: lowStock.map(p => p.name),
      topProducts,
      period: 'last 30 days'
    }
  });
});

app.post('/ai-chat/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { messages, context } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are an AI Business Advisor for STOKIFY, an inventory management system. You are helping a shop owner in Kenya understand and improve their business.

Here is the shop's current data for the last 30 days:
- Total Revenue: KSh ${context?.totalRevenue?.toLocaleString()}
- Total Profit: KSh ${context?.totalProfit?.toLocaleString()}
- Total Expenses: KSh ${context?.totalExpenses?.toLocaleString()}
- Total Transactions: ${context?.totalTransactions}
- Outstanding Credit: KSh ${context?.totalCredit?.toLocaleString()}
- Total Products: ${context?.products}
- Low Stock Items: ${context?.lowStockCount} (${context?.lowStockItems?.join(', ')})
- Top Selling Products: ${context?.topProducts?.map(p => `${p.name} (${p.qty} units)`).join(', ')}

Give practical, actionable advice specific to this shop's data. Use KSh for currency. Keep responses concise and friendly. Use bullet points where helpful. Focus on what will actually help a small Kenyan shop owner grow their business.`,
        messages: messages
      })
    });

    const data = await response.json();
    res.json({ response: data.content[0].text });
  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: 'AI service unavailable' });
  }
});

app.get('/analytics/:store_id', async (req, res) => {
  const { store_id } = req.params;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [productsRes, salesRes, expensesRes] = await Promise.all([
    supabase.from('products').select('*, categories(name)').eq('store_id', store_id),
    supabase.from('sales').select(`total_amount, sold_at, sale_items(quantity, unit_price, products(name, buying_price, category_id, categories(name)))`).eq('store_id', store_id).gte('sold_at', thirtyDaysAgo.toISOString()),
    supabase.from('expenses').select('amount').eq('store_id', store_id).gte('date', thirtyDaysAgo.toISOString().split('T')[0])
  ]);

  const products = productsRes.data || [];
  const sales = salesRes.data || [];
  const expenses = expensesRes.data || [];

  const categoryStats = {};
  products.forEach(p => {
    const cat = p.categories?.name || 'Uncategorised';
    if (!categoryStats[cat]) categoryStats[cat] = { name: cat, products: 0, stockValue: 0, potentialProfit: 0, revenue: 0, unitsSold: 0 };
    categoryStats[cat].products += 1;
    categoryStats[cat].stockValue += p.quantity * p.buying_price;
    categoryStats[cat].potentialProfit += (p.price - p.buying_price) * p.quantity;
  });

  const productStats = {};
  sales.forEach(sale => {
    sale.sale_items?.forEach(item => {
      const name = item.products?.name || 'Unknown';
      const cat = item.products?.categories?.name || 'Uncategorised';
      if (!productStats[name]) productStats[name] = { name, category: cat, revenue: 0, unitsSold: 0, profit: 0 };
      productStats[name].revenue += item.quantity * item.unit_price;
      productStats[name].unitsSold += item.quantity;
      productStats[name].profit += item.quantity * (item.unit_price - (item.products?.buying_price || 0));
      if (categoryStats[cat]) categoryStats[cat].revenue += item.quantity * item.unit_price;
      if (categoryStats[cat]) categoryStats[cat].unitsSold += item.quantity;
    });
  });

  const dayStats = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  sales.forEach(sale => {
    const day = days[new Date(sale.sold_at).getDay()];
    dayStats[day] += sale.total_amount;
  });

  const totalRevenue = sales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const totalCost = sales.reduce((sum, s) => sum + (s.sale_items?.reduce((a, i) => a + (i.products?.buying_price || 0) * i.quantity, 0) || 0), 0);
  const grossProfit = totalRevenue - totalCost;
  const netProfit = grossProfit - totalExpenses;
  const avgOrderValue = sales.length > 0 ? totalRevenue / sales.length : 0;

  const topProducts = Object.values(productStats).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const mostProfitable = Object.values(productStats).sort((a, b) => b.profit - a.profit).slice(0, 5);
  const worstPerforming = Object.values(productStats).sort((a, b) => a.revenue - b.revenue).slice(0, 5);

  const lowStockCount = products.filter(p => p.quantity <= p.low_stock_threshold).length;
  const deadStockCount = products.filter(p => p.quantity > 0).length - Object.keys(productStats).length;
  const inventoryHealthScore = Math.max(0, 100 - (lowStockCount * 5) - (deadStockCount * 3));

  res.json({
    overview: { totalRevenue, totalExpenses, grossProfit, netProfit, avgOrderValue, totalTransactions: sales.length },
    categoryStats: Object.values(categoryStats),
    topProducts,
    mostProfitable,
    worstPerforming,
    dayOfWeek: Object.entries(dayStats).map(([day, revenue]) => ({ day, revenue })),
    inventoryHealth: { score: inventoryHealthScore, lowStockCount, deadStockCount, totalProducts: products.length }
  });
});

app.patch('/stores/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { name } = req.body;
  const { data, error } = await supabase
    .from('stores')
    .update({ name })
    .eq('id', store_id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ store: data[0] });
});

app.get('/accounting/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { period = 'monthly' } = req.query;

  const now = new Date();
  let startDate = new Date();

  if (period === 'monthly') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'quarterly') {
    const quarter = Math.floor(now.getMonth() / 3);
    startDate = new Date(now.getFullYear(), quarter * 3, 1);
  } else if (period === 'annually') {
    startDate = new Date(now.getFullYear(), 0, 1);
  }

  const [salesRes, expensesRes, productsRes, creditRes] = await Promise.all([
    supabase.from('sales').select(`total_amount, sold_at, payment_method, sale_items(quantity, unit_price, products(buying_price, name))`).eq('store_id', store_id).gte('sold_at', startDate.toISOString()).neq('payment_method', 'credit'),
    supabase.from('expenses').select('*').eq('store_id', store_id).gte('date', startDate.toISOString().split('T')[0]),
    supabase.from('products').select('*, categories(name)').eq('store_id', store_id),
    supabase.from('sales').select('total_amount, customers(name)').eq('store_id', store_id).eq('payment_method', 'credit')
  ]);

  const sales = salesRes.data || [];
  const expenses = expensesRes.data || [];
  const products = productsRes.data || [];
  const creditSales = creditRes.data || [];

  // Income Statement
  const revenue = sales.reduce((sum, s) => sum + s.total_amount, 0);
  const cogs = sales.reduce((sum, s) => sum + (s.sale_items?.reduce((a, i) => a + (i.products?.buying_price || 0) * i.quantity, 0) || 0), 0);
  const grossProfit = revenue - cogs;
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = grossProfit - totalExpenses;

  // Expense breakdown by category
  const expensesByCategory = expenses.reduce((acc, e) => {
    if (!acc[e.category]) acc[e.category] = 0;
    acc[e.category] += e.amount;
    return acc;
  }, {});

  // Balance Sheet
  const stockValue = products.reduce((sum, p) => sum + p.quantity * (p.buying_price || 0), 0);
  const accountsReceivable = creditSales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalAssets = stockValue + accountsReceivable + netProfit;
  const totalLiabilities = expenses.filter(e => !e.is_recurring).reduce((sum, e) => sum + e.amount, 0);
  const ownersEquity = totalAssets - totalLiabilities;

  // Payment method breakdown
  const paymentBreakdown = sales.reduce((acc, s) => {
    if (!acc[s.payment_method]) acc[s.payment_method] = 0;
    acc[s.payment_method] += s.total_amount;
    return acc;
  }, {});

  res.json({
    period,
    startDate: startDate.toISOString().split('T')[0],
    endDate: now.toISOString().split('T')[0],
    incomeStatement: {
      revenue,
      cogs,
      grossProfit,
      grossMargin: revenue > 0 ? ((grossProfit / revenue) * 100).toFixed(1) : 0,
      expenses: totalExpenses,
      expensesByCategory,
      netProfit,
      netMargin: revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : 0
    },
    balanceSheet: {
      assets: {
        stockValue,
        accountsReceivable,
        total: totalAssets
      },
      liabilities: {
        total: totalLiabilities
      },
      ownersEquity
    },
    paymentBreakdown
  });
});

// Get all branches for a store
app.get('/branches/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('parent_store_id', store_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ branches: data });
});

// Add a new branch
app.post('/branches', async (req, res) => {
  const { parent_store_id, name, location, business_type, user_id } = req.body;

  const { data: storeData, error: storeError } = await supabase
    .from('stores')
    .insert([{ name, location, business_type, parent_store_id, is_branch: true }])
    .select();
  if (storeError) return res.status(400).json({ error: storeError.message });

  const store = storeData[0];

  const { error: userError } = await supabase
    .from('users')
    .insert([{ id: user_id, store_id: store.id, name, email: '', role: 'manager' }]);
  if (userError) return res.status(400).json({ error: userError.message });

  res.status(201).json({ branch: store });
});

// Get overview of all locations
app.get('/overview/:store_id', async (req, res) => {
  const { store_id } = req.params;

  const { data: branches } = await supabase
    .from('stores')
    .select('*')
    .eq('parent_store_id', store_id);

  const allStoreIds = [store_id, ...(branches || []).map(b => b.id)];

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const locationStats = await Promise.all(allStoreIds.map(async (sid) => {
    const [storeRes, salesRes, productsRes] = await Promise.all([
      supabase.from('stores').select('*').eq('id', sid).single(),
      supabase.from('sales').select('total_amount').eq('store_id', sid).gte('sold_at', thirtyDaysAgo.toISOString()),
      supabase.from('products').select('quantity, buying_price, low_stock_threshold').eq('store_id', sid)
    ]);

    const revenue = salesRes.data?.reduce((sum, s) => sum + s.total_amount, 0) || 0;
    const stockValue = productsRes.data?.reduce((sum, p) => sum + p.quantity * (p.buying_price || 0), 0) || 0;
    const lowStock = productsRes.data?.filter(p => p.quantity <= p.low_stock_threshold).length || 0;

    return {
      id: sid,
      name: storeRes.data?.name,
      location: storeRes.data?.location,
      is_branch: storeRes.data?.is_branch,
      revenue,
      stockValue,
      lowStock,
      transactions: salesRes.data?.length || 0
    };
  }));

  res.json({ locations: locationStats });
});

// Stock transfer between branches
app.post('/stock-transfer', async (req, res) => {
  console.log('Stock transfer request:', req.body);
  const { from_store_id, to_store_id, product_id, quantity, transferred_by, notes } = req.body;

  const { data: product } = await supabase
    .from('products')
    .select('quantity, name')
    .eq('id', product_id)
    .single();

  if (!product || product.quantity < quantity) {
    return res.status(400).json({ error: `Not enough stock. Available: ${product?.quantity || 0}` });
  }

  await supabase
    .from('products')
    .update({ quantity: product.quantity - quantity })
    .eq('id', product_id);

  const { data: destProduct } = await supabase
    .from('products')
    .select('*')
    .eq('store_id', to_store_id)
    .eq('name', product.name)
    .single();

  if (destProduct) {
    await supabase
      .from('products')
      .update({ quantity: destProduct.quantity + quantity })
      .eq('id', destProduct.id);
  } else {
    const { data: sourceProduct } = await supabase
      .from('products')
      .select('*')
      .eq('id', product_id)
      .single();

    await supabase
      .from('products')
      .insert([{ ...sourceProduct, id: undefined, store_id: to_store_id, quantity }]);
  }

  await supabase
    .from('stock_transfers')
    .insert([{ from_store_id, to_store_id, product_name: product.name, quantity, transferred_by, notes }]);

  console.log('Transfer recorded successfully');
  res.json({ message: 'Stock transferred successfully' });
});

// Get transfer history
app.get('/stock-transfers/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('stock_transfers')
    .select('*')
    .or(`from_store_id.eq.${store_id},to_store_id.eq.${store_id}`)
    .order('transferred_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ transfers: data });
});

// Assign staff to a branch
app.patch('/staff/:user_id/branch', async (req, res) => {
  const { user_id } = req.params;
  const { branch_id } = req.body;
  const { data, error } = await supabase
    .from('users')
    .update({ branch_id })
    .eq('id', user_id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ user: data[0] });
});

// Get staff for a specific branch
app.get('/branch-staff/:branch_id', async (req, res) => {
  const { branch_id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('branch_id', branch_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ staff: data });
});

// Get branch performance comparison
app.get('/branch-comparison/:store_id', async (req, res) => {
  const { store_id } = req.params;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: branches } = await supabase
    .from('stores')
    .select('*')
    .eq('parent_store_id', store_id);

  const allStoreIds = [store_id, ...(branches || []).map(b => b.id)];

  const comparison = await Promise.all(allStoreIds.map(async (sid) => {
    const [storeRes, salesRes, productsRes, expensesRes] = await Promise.all([
      supabase.from('stores').select('*').eq('id', sid).single(),
      supabase.from('sales').select(`total_amount, sale_items(quantity, unit_price, products(buying_price))`).eq('store_id', sid).gte('sold_at', thirtyDaysAgo.toISOString()),
      supabase.from('products').select('quantity, buying_price, low_stock_threshold, price').eq('store_id', sid),
      supabase.from('expenses').select('amount').eq('store_id', sid).gte('date', thirtyDaysAgo.toISOString().split('T')[0])
    ]);

    const revenue = salesRes.data?.reduce((sum, s) => sum + s.total_amount, 0) || 0;
    const cogs = salesRes.data?.reduce((sum, s) => sum + (s.sale_items?.reduce((a, i) => a + (i.products?.buying_price || 0) * i.quantity, 0) || 0), 0) || 0;
    const expenses = expensesRes.data?.reduce((sum, e) => sum + e.amount, 0) || 0;
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - expenses;
    const stockValue = productsRes.data?.reduce((sum, p) => sum + p.quantity * (p.buying_price || 0), 0) || 0;
    const lowStock = productsRes.data?.filter(p => p.quantity <= p.low_stock_threshold).length || 0;

    return {
      id: sid,
      name: storeRes.data?.name,
      location: storeRes.data?.location,
      is_branch: storeRes.data?.is_branch || false,
      revenue,
      grossProfit,
      netProfit,
      expenses,
      stockValue,
      lowStock,
      transactions: salesRes.data?.length || 0,
      avgOrderValue: salesRes.data?.length > 0 ? revenue / salesRes.data.length : 0
    };
  }));

  res.json({ comparison });
});

// Update staff profile and salary
app.patch('/staff/:user_id/profile', async (req, res) => {
  const { user_id } = req.params;
  const { name, phone, id_number, job_title, salary, pay_frequency, contract_type, date_joined, crm_permissions } = req.body;
  const { data, error } = await supabase
    .from('users')
    .update({ name, phone, id_number, job_title, salary, pay_frequency, contract_type, date_joined, crm_permissions })
    .eq('id', user_id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ user: data[0] });
});

// Get payroll records for a store
app.get('/payroll/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('payroll')
    .select('*, users(name, job_title, email)')
    .eq('store_id', store_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ payroll: data });
});

// Create payroll record
app.post('/payroll', async (req, res) => {
  const { store_id, user_id, amount, period_start, period_end, payment_date, payment_method, notes } = req.body;
  const { data, error } = await supabase
    .from('payroll')
    .insert([{ store_id, user_id, amount, period_start, period_end, payment_date, payment_method, notes }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ payroll: data[0] });
});

// Update payroll status
app.patch('/payroll/:id', async (req, res) => {
  const { id } = req.params;
  const { status, amount, payment_method, notes, payment_date } = req.body;
  const { data, error } = await supabase
    .from('payroll')
    .update({ status, amount, payment_method, notes, payment_date })
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ payroll: data[0] });
});

// Delete payroll record
app.delete('/payroll/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('payroll')
    .delete()
    .eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Payroll record deleted' });
});

// Generate payroll for all staff
app.post('/payroll/generate/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { period_start, period_end, payment_date } = req.body;

  const { data: staff, error: staffError } = await supabase
    .from('users')
    .select('*')
    .eq('store_id', store_id)
    .neq('role', 'owner')
    .gt('salary', 0);

  if (staffError) return res.status(400).json({ error: staffError.message });

  const payrollRecords = staff.map(member => ({
    store_id,
    user_id: member.id,
    amount: member.salary,
    period_start,
    period_end,
    payment_date,
    status: 'pending',
    payment_method: 'cash'
  }));

  const { data, error } = await supabase
    .from('payroll')
    .insert(payrollRecords)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ payroll: data, message: `Generated ${data.length} payroll records` });
});

// ── VAT ───────────────────────────────────────────────────────────────────────

app.get('/vat/config/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('vat_config')
    .select('*')
    .eq('store_id', store_id)
    .single();
  if (error && error.code !== 'PGRST116') return res.status(400).json({ error: error.message });
  res.json({ config: data || null });
});

app.post('/vat/config', async (req, res) => {
  const { store_id, vat_registered, vat_number, vat_rate, effective_date } = req.body;
  const { data, error } = await supabase
    .from('vat_config')
    .upsert(
      { store_id, vat_registered, vat_number, vat_rate, effective_date, updated_at: new Date().toISOString() },
      { onConflict: 'store_id' }
    )
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ config: data[0] });
});

app.get('/vat/return/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { start_date, end_date } = req.query;

  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const defaultEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const from = start_date || defaultStart;
  const to   = end_date   || defaultEnd;

  // Get VAT config for the store's rate
  const { data: config } = await supabase
    .from('vat_config')
    .select('vat_rate')
    .eq('store_id', store_id)
    .single();
  const vatRate = config?.vat_rate ?? 16;
  const vatFactor = vatRate / 100;

  // Output VAT — from sales in the period
  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('total_amount, sold_at, payment_method')
    .eq('store_id', store_id)
    .gte('sold_at', `${from}T00:00:00`)
    .lte('sold_at', `${to}T23:59:59`);
  if (salesError) return res.status(400).json({ error: salesError.message });

  // Input VAT — from expenses in the period
  const { data: expenses, error: expensesError } = await supabase
    .from('expenses')
    .select('amount, date, category, description')
    .eq('store_id', store_id)
    .gte('date', from)
    .lte('date', to);
  if (expensesError) return res.status(400).json({ error: expensesError.message });

  // Build output VAT entries (VAT is inclusive — extract from gross)
  const outputEntries = (sales || []).map(s => {
    const gross  = s.total_amount || 0;
    const net    = parseFloat((gross / (1 + vatFactor)).toFixed(2));
    const vat    = parseFloat((gross - net).toFixed(2));
    return {
      source: 'sale',
      description: `Sale — ${s.payment_method || 'cash'}`,
      entry_date: s.sold_at?.split('T')[0],
      net_amount: net,
      vat_amount: vat,
      gross_amount: gross,
    };
  });

  // Build input VAT entries (assume VAT-inclusive expenses)
  const inputEntries = (expenses || []).map(e => {
    const gross = e.amount || 0;
    const net   = parseFloat((gross / (1 + vatFactor)).toFixed(2));
    const vat   = parseFloat((gross - net).toFixed(2));
    return {
      source: 'expense',
      description: e.description || e.category || 'Expense',
      entry_date: e.date,
      net_amount: net,
      vat_amount: vat,
      gross_amount: gross,
    };
  });

  const totalOutputVat  = outputEntries.reduce((s, e) => s + e.vat_amount, 0);
  const totalInputVat   = inputEntries.reduce((s, e) => s + e.vat_amount, 0);
  const netVatPayable   = parseFloat((totalOutputVat - totalInputVat).toFixed(2));
  const totalOutputNet  = outputEntries.reduce((s, e) => s + e.net_amount, 0);
  const totalInputNet   = inputEntries.reduce((s, e) => s + e.net_amount, 0);

  res.json({
    period: { from, to },
    vat_rate: vatRate,
    summary: {
      output_vat: parseFloat(totalOutputVat.toFixed(2)),
      input_vat:  parseFloat(totalInputVat.toFixed(2)),
      net_vat_payable: netVatPayable,
      total_output_net: parseFloat(totalOutputNet.toFixed(2)),
      total_input_net:  parseFloat(totalInputNet.toFixed(2)),
    },
    output_entries: outputEntries,
    input_entries:  inputEntries,
  });
});

// ── INVOICES ─────────────────────────────────────────────────────────────────

app.get('/invoices/:store_id/summary', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('invoices')
    .select('status, total')
    .eq('store_id', store_id);
  if (error) return res.status(400).json({ error: error.message });

  const today = new Date().toISOString().split('T')[0];
  const summary = { all: 0, unpaid: 0, paid: 0, overdue: 0, cancelled: 0,
                    total_unpaid: 0, total_paid: 0, total_overdue: 0, total_outstanding: 0 };
  (data || []).forEach(inv => {
    summary.all++;
    summary[inv.status] = (summary[inv.status] || 0) + 1;
    if (inv.status === 'unpaid') { summary.total_unpaid += inv.total; summary.total_outstanding += inv.total; }
    if (inv.status === 'paid')   summary.total_paid += inv.total;
    if (inv.status === 'overdue') { summary.total_overdue += inv.total; summary.total_outstanding += inv.total; }
  });
  res.json({ summary });
});

app.get('/invoices/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('invoices')
    .select('*, invoice_items(*)')
    .eq('store_id', store_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ invoices: data });
});

app.post('/invoices', async (req, res) => {
  const { store_id, customer_name, customer_email, customer_phone,
          issue_date, due_date, vat_rate, subtotal, vat_amount, total, notes, items } = req.body;

  const date = new Date();
  const datePart = date.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  const invoice_number = `INV-${datePart}-${rand}`;

  const { data: inv, error: invError } = await supabase
    .from('invoices')
    .insert([{ store_id, invoice_number, customer_name, customer_email, customer_phone,
               issue_date, due_date, vat_rate, subtotal, vat_amount, total, notes, status: 'unpaid' }])
    .select();
  if (invError) return res.status(400).json({ error: invError.message });

  const invoice = inv[0];

  if (items && items.length > 0) {
    const rows = items.map(item => ({
      invoice_id:  invoice.id,
      description: item.description,
      quantity:    item.quantity,
      unit_price:  item.unit_price,
      total:       item.total,
    }));
    const { error: itemsError } = await supabase.from('invoice_items').insert(rows);
    if (itemsError) return res.status(400).json({ error: itemsError.message });
  }

  const { data: full } = await supabase
    .from('invoices')
    .select('*, invoice_items(*)')
    .eq('id', invoice.id)
    .single();

  res.status(201).json({ invoice: full });
});

app.put('/invoices/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (body.status !== undefined)         updates.status         = body.status;
  if (body.customer_name !== undefined)  updates.customer_name  = body.customer_name;
  if (body.customer_email !== undefined) updates.customer_email = body.customer_email;
  if (body.customer_phone !== undefined) updates.customer_phone = body.customer_phone;
  if (body.due_date !== undefined)       updates.due_date       = body.due_date;
  if (body.notes !== undefined)          updates.notes          = body.notes;
  if (body.vat_rate !== undefined)       updates.vat_rate       = body.vat_rate;
  if (body.vat_amount !== undefined)     updates.vat_amount     = body.vat_amount;
  if (body.subtotal !== undefined)       updates.subtotal       = body.subtotal;
  if (body.total !== undefined)          updates.total          = body.total;
  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ invoice: data[0] });
});

app.delete('/invoices/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Invoice deleted' });
});

// ── PURCHASE ORDERS ──────────────────────────────────────────────────────────

app.get('/purchase-orders/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, purchase_order_items(*)')
    .eq('store_id', store_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ purchase_orders: data });
});

app.post('/purchase-orders', async (req, res) => {
  const { store_id, supplier_id, supplier_name, order_date, expected_date, notes, subtotal, total, items } = req.body;

  const date = new Date();
  const datePart = date.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  const po_number = `PO-${datePart}-${rand}`;

  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .insert([{ store_id, po_number, supplier_id: supplier_id || null, supplier_name, order_date, expected_date: expected_date || null, notes: notes || null, subtotal: subtotal || 0, total: total || 0, status: 'draft' }])
    .select();
  if (poError) return res.status(400).json({ error: poError.message });

  const order = po[0];

  if (items && items.length > 0) {
    const rows = items.map(item => ({
      po_id:        order.id,
      product_id:   item.product_id || null,
      product_name: item.product_name,
      quantity:     item.quantity,
      unit_cost:    item.unit_cost,
      total:        item.total,
      received_qty: 0,
    }));
    const { error: itemsError } = await supabase.from('purchase_order_items').insert(rows);
    if (itemsError) return res.status(400).json({ error: itemsError.message });
  }

  const { data: full } = await supabase
    .from('purchase_orders')
    .select('*, purchase_order_items(*)')
    .eq('id', order.id)
    .single();

  res.status(201).json({ purchase_order: full });
});

app.put('/purchase-orders/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (body.status !== undefined)        updates.status        = body.status;
  if (body.supplier_name !== undefined) updates.supplier_name = body.supplier_name;
  if (body.supplier_id !== undefined)   updates.supplier_id   = body.supplier_id;
  if (body.order_date !== undefined)    updates.order_date    = body.order_date;
  if (body.expected_date !== undefined) updates.expected_date = body.expected_date;
  if (body.notes !== undefined)         updates.notes         = body.notes;
  if (body.subtotal !== undefined)      updates.subtotal      = body.subtotal;
  if (body.total !== undefined)         updates.total         = body.total;
  const { data, error } = await supabase
    .from('purchase_orders')
    .update(updates)
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ purchase_order: data[0] });
});

app.delete('/purchase-orders/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Purchase order deleted' });
});

app.put('/purchase-orders/:id/receive', async (req, res) => {
  const { id } = req.params;
  const { received_items } = req.body;
  // received_items: [{ item_id, received_qty, product_id }]

  for (const ri of received_items) {
    // Update received_qty on the PO item
    await supabase
      .from('purchase_order_items')
      .update({ received_qty: ri.received_qty })
      .eq('id', ri.item_id);

    // Add to product stock if product_id is set and qty > 0
    if (ri.product_id && ri.received_qty > 0) {
      const { data: product } = await supabase
        .from('products')
        .select('quantity')
        .eq('id', ri.product_id)
        .single();
      if (product) {
        await supabase
          .from('products')
          .update({ quantity: product.quantity + ri.received_qty })
          .eq('id', ri.product_id);
      }
    }
  }

  // Mark PO as received
  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'received', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, purchase_order_items(*)');
  if (error) return res.status(400).json({ error: error.message });

  const po = data[0];

  // Auto-log supplier delivery record
  if (po?.supplier_id) {
    const actualDate = new Date().toISOString().split('T')[0];
    const expectedDate = po.expected_date;
    const status = !expectedDate ? 'on_time' : actualDate <= expectedDate ? 'on_time' : 'late';
    await supabase.from('supplier_deliveries').insert([{
      store_id: po.store_id,
      supplier_id: po.supplier_id,
      po_id: po.id,
      expected_date: expectedDate || null,
      actual_date: actualDate,
      status,
    }]);
  }

  res.json({ purchase_order: po });
});

// ── CRM / CUSTOMERS ──────────────────────────────────────────────────────────

app.get('/customers/:store_id/followups', async (req, res) => {
  const { store_id } = req.params;
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('store_id', store_id)
    .not('followup_date', 'is', null)
    .lte('followup_date', today)
    .order('followup_date', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ customers: data });
});

app.get('/customers/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data: customers, error } = await supabase
    .from('customers')
    .select('*')
    .eq('store_id', store_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });

  // Attach invoice totals for each customer
  const enriched = await Promise.all((customers || []).map(async (c) => {
    const { data: invs } = await supabase
      .from('invoices')
      .select('total, status')
      .eq('customer_id', c.id);
    const total_spend = (invs || []).reduce((s, i) => s + (i.total || 0), 0);
    const outstanding_balance = (invs || [])
      .filter(i => i.status !== 'paid' && i.status !== 'cancelled')
      .reduce((s, i) => s + (i.total || 0), 0);
    return { ...c, total_spend, outstanding_balance };
  }));

  res.json({ customers: enriched });
});

app.post('/customers', async (req, res) => {
  const { store_id, name, phone, email, location, notes, followup_date, followup_note } = req.body;
  const { data, error } = await supabase
    .from('customers')
    .insert([{ store_id, name, phone, email, location, notes, followup_date: followup_date || null, followup_note: followup_note || null }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ customer: data[0] });
});

app.put('/customers/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const updates = { updated_at: new Date().toISOString() };
  if (body.name !== undefined)          updates.name          = body.name;
  if (body.phone !== undefined)         updates.phone         = body.phone;
  if (body.email !== undefined)         updates.email         = body.email;
  if (body.location !== undefined)      updates.location      = body.location;
  if (body.notes !== undefined)         updates.notes         = body.notes;
  if (body.followup_date !== undefined) updates.followup_date = body.followup_date;
  if (body.followup_note !== undefined) updates.followup_note = body.followup_note;
  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ customer: data[0] });
});

app.delete('/customers/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Customer deleted' });
});

app.get('/customers/:id/profile', async (req, res) => {
  const { id } = req.params;
  const { data: customer, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return res.status(400).json({ error: error.message });

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, issue_date, total, status')
    .eq('customer_id', id)
    .order('issue_date', { ascending: false });

  const total_spend = (invoices || []).reduce((s, i) => s + (i.total || 0), 0);
  const outstanding_balance = (invoices || [])
    .filter(i => i.status !== 'paid' && i.status !== 'cancelled')
    .reduce((s, i) => s + (i.total || 0), 0);

  res.json({ customer: { ...customer, total_spend, outstanding_balance }, invoices: invoices || [] });
});

app.patch('/customers/:id/followup', async (req, res) => {
  const { id } = req.params;
  const { followup_date, followup_note } = req.body;
  const { data, error } = await supabase
    .from('customers')
    .update({ followup_date: followup_date || null, followup_note: followup_note || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ customer: data[0] });
});

// ── SUPPLIER SCORECARD & DELIVERIES ─────────────────────────────────────────

app.get('/suppliers/:store_id/scorecard', async (req, res) => {
  const { store_id } = req.params;
  const { data: suppliers, error } = await supabase
    .from('suppliers').select('*').eq('store_id', store_id);
  if (error) return res.status(400).json({ error: error.message });

  const scorecard = await Promise.all((suppliers || []).map(async (s) => {
    const [posRes, deliveriesRes] = await Promise.all([
      supabase.from('purchase_orders').select('id, total, status').eq('supplier_id', s.id),
      supabase.from('supplier_deliveries').select('*').eq('supplier_id', s.id),
    ]);

    const pos = posRes.data || [];
    const deliveries = deliveriesRes.data || [];
    const totalOrders = pos.length;
    const totalSpend = pos.filter(p => p.status === 'received').reduce((sum, p) => sum + (p.total || 0), 0);
    const onTimeCount = deliveries.filter(d => d.status === 'on_time').length;
    const lateCount = deliveries.filter(d => d.status === 'late').length;
    const onTimeRate = deliveries.length > 0 ? Math.round((onTimeCount / deliveries.length) * 100) : null;

    const avgLeadTime = deliveries.filter(d => d.actual_date && d.expected_date).length > 0
      ? Math.round(deliveries.filter(d => d.actual_date && d.expected_date)
          .reduce((sum, d) => {
            const diff = (new Date(d.actual_date) - new Date(d.expected_date)) / (1000 * 60 * 60 * 24);
            return sum + diff;
          }, 0) / deliveries.filter(d => d.actual_date && d.expected_date).length)
      : null;

    return { id: s.id, name: s.name, phone: s.phone, lead_time_days: s.lead_time_days,
             totalOrders, totalSpend, onTimeCount, lateCount, onTimeRate, avgLeadTime };
  }));

  res.json({ scorecard });
});

app.get('/supplier-deliveries/:supplier_id', async (req, res) => {
  const { supplier_id } = req.params;
  const { data, error } = await supabase
    .from('supplier_deliveries')
    .select('*, purchase_orders(po_number)')
    .eq('supplier_id', supplier_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ deliveries: data });
});

app.post('/supplier-deliveries', async (req, res) => {
  const { store_id, supplier_id, po_id, expected_date, actual_date, notes } = req.body;
  let status = 'pending';
  if (actual_date) {
    status = !expected_date || actual_date <= expected_date ? 'on_time' : 'late';
  }
  const { data, error } = await supabase
    .from('supplier_deliveries')
    .insert([{ store_id, supplier_id, po_id: po_id || null, expected_date: expected_date || null, actual_date: actual_date || null, status, notes: notes || null }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ delivery: data[0] });
});

app.patch('/supplier-deliveries/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  const updates = {};
  if (body.actual_date !== undefined) updates.actual_date = body.actual_date;
  if (body.status !== undefined)      updates.status      = body.status;
  if (body.notes !== undefined)       updates.notes       = body.notes;
  // Recalculate status if actual_date provided without explicit status
  if (body.actual_date && !body.status) {
    const { data: existing } = await supabase.from('supplier_deliveries').select('expected_date').eq('id', id).single();
    if (existing) {
      updates.status = !existing.expected_date || body.actual_date <= existing.expected_date ? 'on_time' : 'late';
    }
  }
  const { data, error } = await supabase
    .from('supplier_deliveries').update(updates).eq('id', id).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ delivery: data[0] });
});

// ── SUPPLIER PRICE HISTORY ────────────────────────────────────────────────────

app.get('/supplier-price-history/:supplier_id', async (req, res) => {
  const { supplier_id } = req.params;
  const { data, error } = await supabase
    .from('supplier_price_history')
    .select('*')
    .eq('supplier_id', supplier_id)
    .order('recorded_date', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ history: data });
});

app.post('/supplier-price-history', async (req, res) => {
  const { store_id, supplier_id, product_id, product_name, unit_cost, recorded_date, notes } = req.body;
  const { data, error } = await supabase
    .from('supplier_price_history')
    .insert([{ store_id, supplier_id, product_id: product_id || null, product_name, unit_cost, recorded_date, notes: notes || null }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ entry: data[0] });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});