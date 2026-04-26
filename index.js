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
  const { store_id, name, sku, quantity, low_stock_threshold, price, buying_price, supplier_id, category_id } = req.body;
  const { data, error } = await supabase
    .from('products')
    .insert([{ store_id, name, sku, quantity, low_stock_threshold, price, buying_price, supplier_id, category_id }])
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
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('*, suppliers(name, phone, contact_email), categories(name)')
    .eq('store_id', store_id)
    .filter('quantity', 'lte', supabase.raw('low_stock_threshold'));

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



app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});