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
  const { store_id, name, sku, quantity, low_stock_threshold, price } = req.body;
  const { data, error } = await supabase
    .from('products')
    .insert([{ store_id, name, sku, quantity, low_stock_threshold, price }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ product: data[0] });
});

app.get('/products/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('products')
    .select('*')
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

app.get('/products/lowstock/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('store_id', store_id)
    .filter('quantity', 'lte', supabase.raw('low_stock_threshold'));
  if (error) return res.status(400).json({ error: error.message });
  res.json({ low_stock_products: data });
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

app.get('/products/:store_id', async (req, res) => {
  const { store_id } = req.params;
  const { data, error } = await supabase
    .from('products')
    .select('*, suppliers(name)')
    .eq('store_id', store_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ products: data });
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



app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});