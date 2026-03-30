import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, Upload, Download, Receipt, Package, Wallet, BarChart3, Cloud, Users, Search, Database, Wifi, WifiOff } from 'lucide-react';

// Optional Supabase connection.
// To enable live cloud sync, add these env vars in your deployment:
// VITE_SUPABASE_URL=...
// VITE_SUPABASE_ANON_KEY=...
const STORAGE_KEY = 'nokta_live_bookkeeping_v2';
const MYR = new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' });

const SETTINGS = {
  brands: ['Nokta Coffee', 'The Purnama Ice', 'Catering'],
  categories: ['Sales - QR', 'Sales - Cash', 'Sales - Event', 'COGS', 'Salary', 'Rent', 'Transport', 'Marketing', 'Utilities', 'Owner Injection', 'Owner Drawing', 'Other Expense'],
  paymentMethods: ['QR', 'Cash', 'Bank Transfer', 'Card', 'Other'],
};

const seed = {
  transactions: [],
  receipts: [],
  inventoryItems: [
    { id: crypto.randomUUID(), sku: 'ICE-001', name: 'Ice cream core', unit: 'pcs', qtyOnHand: 0, reorderLevel: 20, avgCost: 0, brand: 'The Purnama Ice' },
    { id: crypto.randomUUID(), sku: 'ICE-002', name: 'Coating / crumbs', unit: 'pack', qtyOnHand: 0, reorderLevel: 3, avgCost: 0, brand: 'The Purnama Ice' },
    { id: crypto.randomUUID(), sku: 'ICE-003', name: 'Packaging cup', unit: 'pcs', qtyOnHand: 0, reorderLevel: 50, avgCost: 0, brand: 'The Purnama Ice' },
    { id: crypto.randomUUID(), sku: 'COF-001', name: 'Coffee beans', unit: 'kg', qtyOnHand: 0, reorderLevel: 2, avgCost: 0, brand: 'Nokta Coffee' },
    { id: crypto.randomUUID(), sku: 'COF-002', name: 'Milk', unit: 'liter', qtyOnHand: 0, reorderLevel: 10, avgCost: 0, brand: 'Nokta Coffee' },
    { id: crypto.randomUUID(), sku: 'COF-003', name: 'Cup & lid', unit: 'pcs', qtyOnHand: 0, reorderLevel: 100, avgCost: 0, brand: 'Nokta Coffee' },
  ],
  inventoryMoves: [],
  settings: SETTINGS,
};

function monthKey(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadText(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Stat({ title, value, icon: Icon, subtitle }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">{title}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
            {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          <div className="rounded-2xl bg-slate-100 p-3"><Icon className="h-5 w-5" /></div>
        </div>
      </CardContent>
    </Card>
  );
}

function RowShell({ children }) {
  return <div className="flex flex-col gap-3 rounded-2xl border bg-white p-4 md:flex-row md:items-center md:justify-between">{children}</div>;
}

export default function NoktaSenjaSupabaseDashboard() {
  const [data, setData] = useState(seed);
  const [mode, setMode] = useState('local');
  const [syncState, setSyncState] = useState('offline');
  const [supabase, setSupabase] = useState(null);
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const importRef = useRef(null);
  const receiptRef = useRef(null);

  const [txForm, setTxForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    brand: 'Nokta Coffee',
    type: 'income',
    category: 'Sales - QR',
    paymentMethod: 'QR',
    amount: '',
    description: '',
    reference: '',
    receiptId: '',
  });
  const [receiptForm, setReceiptForm] = useState({
    date: new Date().toISOString().slice(0, 10), brand: 'Nokta Coffee', vendor: '', note: ''
  });
  const [inventoryForm, setInventoryForm] = useState({
    sku: '', name: '', unit: 'pcs', qtyOnHand: '', reorderLevel: '', avgCost: '', brand: 'Nokta Coffee'
  });
  const [moveForm, setMoveForm] = useState({
    date: new Date().toISOString().slice(0, 10), itemId: '', type: 'in', qty: '', unitCost: '', note: ''
  });

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { setData(JSON.parse(raw)); } catch { setData(seed); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    async function initSupabase() {
      try {
        const url = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_URL : undefined;
        const key = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_ANON_KEY : undefined;
        if (!url || !key) return;
        const mod = await import('@supabase/supabase-js');
        const client = mod.createClient(url, key);
        setSupabase(client);
        setSyncState('ready');
      } catch (e) {
        console.warn('Supabase not initialised', e);
      }
    }
    initSupabase();
  }, []);

  async function loadFromSupabase() {
    if (!supabase) return;
    setSyncState('syncing');
    try {
      const [tx, receipts, items, moves] = await Promise.all([
        supabase.from('transactions').select('*').order('date', { ascending: false }),
        supabase.from('receipts').select('*').order('date', { ascending: false }),
        supabase.from('inventory_items').select('*').order('name'),
        supabase.from('inventory_moves').select('*').order('date', { ascending: false }),
      ]);
      setData((prev) => ({
        ...prev,
        transactions: tx.data || [],
        receipts: receipts.data || [],
        inventoryItems: items.data || prev.inventoryItems,
        inventoryMoves: moves.data || [],
      }));
      setMode('cloud');
      setSyncState('online');
    } catch {
      setSyncState('offline');
    }
  }

  async function saveRow(table, row) {
    if (!supabase || mode !== 'cloud') return;
    await supabase.from(table).upsert(row);
  }

  async function deleteRow(table, id) {
    if (!supabase || mode !== 'cloud') return;
    await supabase.from(table).delete().eq('id', id);
  }

  const months = useMemo(() => {
    const m = new Set(data.transactions.map((t) => monthKey(t.date)).filter(Boolean));
    return Array.from(m).sort().reverse();
  }, [data.transactions]);

  const filteredTransactions = useMemo(() => {
    return data.transactions
      .filter((t) => {
        const a = !brandFilter || brandFilter === 'all' || t.brand === brandFilter;
        const b = !monthFilter || monthFilter === 'all' || monthKey(t.date) === monthFilter;
        const c = !search || `${t.description} ${t.reference} ${t.brand} ${t.category}`.toLowerCase().includes(search.toLowerCase());
        return a && b && c;
      })
      .sort((a, b) => `${b.date}`.localeCompare(`${a.date}`));
  }, [data.transactions, brandFilter, monthFilter, search]);

  const dashboard = useMemo(() => {
    const txs = data.transactions.filter((t) => {
      const a = !brandFilter || brandFilter === 'all' || t.brand === brandFilter;
      const b = !monthFilter || monthFilter === 'all' || monthKey(t.date) === monthFilter;
      return a && b;
    });
    const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
    const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
    const cogs = txs.filter((t) => t.category === 'COGS').reduce((s, t) => s + Number(t.amount || 0), 0);
    return { income, expense, cogs, gross: income - cogs, net: income - expense };
  }, [data.transactions, brandFilter, monthFilter]);

  const pnlRows = useMemo(() => {
    const map = new Map();
    data.transactions.forEach((t) => {
      const key = `${monthKey(t.date)}__${t.brand}`;
      if (!map.has(key)) map.set(key, { month: monthKey(t.date), brand: t.brand, income: 0, expense: 0, cogs: 0 });
      const row = map.get(key);
      const amount = Number(t.amount || 0);
      if (t.type === 'income') row.income += amount;
      if (t.type === 'expense') row.expense += amount;
      if (t.category === 'COGS') row.cogs += amount;
    });
    return Array.from(map.values()).map((r) => ({ ...r, gross: r.income - r.cogs, net: r.income - r.expense })).sort((a, b) => `${b.month}${b.brand}`.localeCompare(`${a.month}${a.brand}`));
  }, [data.transactions]);

  const lowStock = useMemo(() => data.inventoryItems.filter((i) => Number(i.qtyOnHand || 0) <= Number(i.reorderLevel || 0)), [data.inventoryItems]);

  async function addTransaction() {
    if (!txForm.date || !txForm.amount) return;
    const row = { id: crypto.randomUUID(), ...txForm, amount: Number(txForm.amount), created_at: new Date().toISOString() };
    setData((prev) => ({ ...prev, transactions: [row, ...prev.transactions] }));
    await saveRow('transactions', row);
    setTxForm((f) => ({ ...f, amount: '', description: '', reference: '', receiptId: '' }));
  }

  async function addReceipt() {
    const file = receiptRef.current?.files?.[0];
    if (!file) return;
    const image = await readAsDataUrl(file);
    const row = {
      id: crypto.randomUUID(),
      date: receiptForm.date,
      brand: receiptForm.brand,
      vendor: receiptForm.vendor,
      note: receiptForm.note,
      filename: file.name,
      mime_type: file.type,
      image,
      created_at: new Date().toISOString(),
    };
    setData((prev) => ({ ...prev, receipts: [row, ...prev.receipts] }));
    await saveRow('receipts', row);
    setReceiptForm({ date: new Date().toISOString().slice(0, 10), brand: receiptForm.brand, vendor: '', note: '' });
    if (receiptRef.current) receiptRef.current.value = '';
  }

  async function addInventoryItem() {
    if (!inventoryForm.name) return;
    const row = {
      id: crypto.randomUUID(),
      sku: inventoryForm.sku,
      name: inventoryForm.name,
      unit: inventoryForm.unit,
      qtyOnHand: Number(inventoryForm.qtyOnHand || 0),
      reorderLevel: Number(inventoryForm.reorderLevel || 0),
      avgCost: Number(inventoryForm.avgCost || 0),
      brand: inventoryForm.brand,
    };
    setData((prev) => ({ ...prev, inventoryItems: [row, ...prev.inventoryItems] }));
    await saveRow('inventory_items', row);
    setInventoryForm((f) => ({ ...f, sku: '', name: '', qtyOnHand: '', reorderLevel: '', avgCost: '' }));
  }

  async function addInventoryMove() {
    if (!moveForm.itemId || !moveForm.qty) return;
    const qty = Number(moveForm.qty || 0);
    const row = { id: crypto.randomUUID(), ...moveForm, qty, unitCost: Number(moveForm.unitCost || 0) };
    setData((prev) => {
      const items = prev.inventoryItems.map((i) => {
        if (i.id !== moveForm.itemId) return i;
        const delta = moveForm.type === 'in' ? qty : -qty;
        return { ...i, qtyOnHand: Number(i.qtyOnHand || 0) + delta };
      });
      return { ...prev, inventoryMoves: [row, ...prev.inventoryMoves], inventoryItems: items };
    });
    await saveRow('inventory_moves', row);
    const item = data.inventoryItems.find((i) => i.id === moveForm.itemId);
    if (item) {
      const delta = moveForm.type === 'in' ? qty : -qty;
      await saveRow('inventory_items', { ...item, qtyOnHand: Number(item.qtyOnHand || 0) + delta });
    }
    setMoveForm({ date: new Date().toISOString().slice(0, 10), itemId: '', type: 'in', qty: '', unitCost: '', note: '' });
  }

  async function removeItem(key, id, table) {
    setData((prev) => ({ ...prev, [key]: prev[key].filter((x) => x.id !== id) }));
    await deleteRow(table, id);
  }

  function exportCsv() {
    const rows = [
      ['Date', 'Brand', 'Type', 'Category', 'Payment Method', 'Amount', 'Description', 'Reference', 'Receipt ID'],
      ...data.transactions.map((t) => [t.date, t.brand, t.type, t.category, t.paymentMethod, t.amount, t.description, t.reference, t.receiptId])
    ];
    downloadText('nokta_transactions.csv', rows.map((r) => r.map(csvEscape).join(',')).join('\n'), 'text/csv');
  }

  function exportBackup() {
    downloadText('nokta_live_backup.json', JSON.stringify(data, null, 2), 'application/json');
  }

  async function importBackup(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setData(JSON.parse(text));
  }

  const syncBadge = syncState === 'online'
    ? <Badge className="gap-1"><Wifi className="h-3 w-3" />Cloud Live</Badge>
    : syncState === 'ready' || syncState === 'syncing'
      ? <Badge variant="secondary" className="gap-1"><Cloud className="h-3 w-3" />Supabase Ready</Badge>
      : <Badge variant="outline" className="gap-1"><WifiOff className="h-3 w-3" />Local Only</Badge>;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Nokta Senja • Supabase + Web Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">Live bookkeeping, attach resit, inventory, P&amp;L, dan dashboard untuk partner tengok sekali.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {syncBadge}
            {supabase ? <Button variant="outline" onClick={loadFromSupabase}><Database className="mr-2 h-4 w-4" />Connect Cloud</Button> : <Button variant="outline" disabled><Database className="mr-2 h-4 w-4" />Cloud Not Set</Button>}
            <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />CSV</Button>
            <Button variant="outline" onClick={exportBackup}><Download className="mr-2 h-4 w-4" />Backup</Button>
            <input ref={importRef} type="file" className="hidden" accept="application/json" onChange={importBackup} />
            <Button onClick={() => importRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Import</Button>
          </div>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5">
            <Stat title="Sales" value={MYR.format(dashboard.income)} icon={Wallet} />
            <Stat title="Expenses" value={MYR.format(dashboard.expense)} icon={Receipt} />
            <Stat title="COGS" value={MYR.format(dashboard.cogs)} icon={Package} />
            <Stat title="Gross Profit" value={MYR.format(dashboard.gross)} icon={BarChart3} />
            <Stat title="Net Profit" value={MYR.format(dashboard.net)} icon={Users} subtitle={brandFilter === 'all' ? 'All brands' : brandFilter} />
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" placeholder="Cari transaction / brand / ref" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Brand</Label>
              <Select value={brandFilter} onValueChange={setBrandFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All brands</SelectItem>
                  {SETTINGS.brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Month</Label>
              <Select value={monthFilter} onValueChange={setMonthFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All months</SelectItem>
                  {months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Low stock</Label>
              <div className="rounded-xl border bg-white p-3 text-sm">{lowStock.length} item below reorder level</div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="dashboard" className="space-y-4">
          <TabsList className="grid w-full grid-cols-6 rounded-2xl">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="receipts">Receipts</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
            <TabsTrigger value="setup">Setup</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader><CardTitle>Recent transactions</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {filteredTransactions.slice(0, 8).map((t) => (
                    <RowShell key={t.id}>
                      <div>
                        <div className="flex flex-wrap gap-2"><Badge variant="outline">{t.brand}</Badge><Badge variant={t.type === 'income' ? 'default' : 'secondary'}>{t.category}</Badge></div>
                        <p className="mt-2 font-medium">{t.description || 'No description'}</p>
                        <p className="text-sm text-slate-500">{t.date} • {t.paymentMethod} {t.reference ? `• ${t.reference}` : ''}</p>
                      </div>
                      <div className={`text-lg font-semibold ${t.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>{t.type === 'income' ? '+' : '-'}{MYR.format(Number(t.amount || 0))}</div>
                    </RowShell>
                  ))}
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader><CardTitle>Low stock alerts</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {lowStock.length === 0 ? <p className="text-sm text-slate-500">Semua stock ok.</p> : lowStock.map((i) => (
                    <RowShell key={i.id}>
                      <div>
                        <div className="flex flex-wrap gap-2"><Badge variant="outline">{i.brand}</Badge><Badge variant="secondary">{i.sku || 'No SKU'}</Badge></div>
                        <p className="mt-2 font-medium">{i.name}</p>
                        <p className="text-sm text-slate-500">On hand {i.qtyOnHand} {i.unit} • Reorder {i.reorderLevel}</p>
                      </div>
                      <Badge variant="destructive">Restock</Badge>
                    </RowShell>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="transactions" className="space-y-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Add transaction</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div><Label>Date</Label><Input type="date" value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} /></div>
                <div><Label>Brand</Label><Select value={txForm.brand} onValueChange={(v) => setTxForm({ ...txForm, brand: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SETTINGS.brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Type</Label><Select value={txForm.type} onValueChange={(v) => setTxForm({ ...txForm, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="income">Income</SelectItem><SelectItem value="expense">Expense</SelectItem></SelectContent></Select></div>
                <div><Label>Category</Label><Select value={txForm.category} onValueChange={(v) => setTxForm({ ...txForm, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SETTINGS.categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Payment Method</Label><Select value={txForm.paymentMethod} onValueChange={(v) => setTxForm({ ...txForm, paymentMethod: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SETTINGS.paymentMethods.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Amount</Label><Input type="number" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} /></div>
                <div><Label>Reference</Label><Input value={txForm.reference} onChange={(e) => setTxForm({ ...txForm, reference: e.target.value })} /></div>
                <div><Label>Receipt ID</Label><Input value={txForm.receiptId} onChange={(e) => setTxForm({ ...txForm, receiptId: e.target.value })} /></div>
                <div className="md:col-span-2 xl:col-span-4"><Label>Description</Label><Textarea value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} /></div>
                <div className="xl:col-span-4"><Button onClick={addTransaction}><Plus className="mr-2 h-4 w-4" />Add Transaction</Button></div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Ledger</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {filteredTransactions.map((t) => (
                  <RowShell key={t.id}>
                    <div>
                      <div className="flex flex-wrap gap-2"><Badge variant="outline">{t.brand}</Badge><Badge variant={t.type === 'income' ? 'default' : 'secondary'}>{t.category}</Badge><Badge variant="outline">{t.date}</Badge></div>
                      <p className="mt-2 font-medium">{t.description || 'No description'}</p>
                      <p className="text-sm text-slate-500">{t.paymentMethod} {t.reference ? `• ${t.reference}` : ''} {t.receiptId ? `• receipt ${t.receiptId}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`text-lg font-semibold ${t.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>{t.type === 'income' ? '+' : '-'}{MYR.format(Number(t.amount || 0))}</div>
                      <Button variant="ghost" size="icon" onClick={() => removeItem('transactions', t.id, 'transactions')}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </RowShell>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receipts" className="space-y-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Upload receipt / invoice</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div><Label>Date</Label><Input type="date" value={receiptForm.date} onChange={(e) => setReceiptForm({ ...receiptForm, date: e.target.value })} /></div>
                <div><Label>Brand</Label><Select value={receiptForm.brand} onValueChange={(v) => setReceiptForm({ ...receiptForm, brand: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SETTINGS.brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Vendor</Label><Input value={receiptForm.vendor} onChange={(e) => setReceiptForm({ ...receiptForm, vendor: e.target.value })} /></div>
                <div><Label>File</Label><Input ref={receiptRef} type="file" accept="image/*,.pdf" /></div>
                <div className="md:col-span-2 xl:col-span-4"><Label>Note</Label><Textarea value={receiptForm.note} onChange={(e) => setReceiptForm({ ...receiptForm, note: e.target.value })} /></div>
                <div className="xl:col-span-4"><Button onClick={addReceipt}><Upload className="mr-2 h-4 w-4" />Save Receipt</Button></div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.receipts.map((r) => (
                <Card key={r.id} className="overflow-hidden rounded-2xl shadow-sm">
                  <div className="aspect-[4/3] bg-slate-100">
                    {r.mime_type?.includes('pdf') ? <div className="flex h-full items-center justify-center text-sm text-slate-500">PDF saved: {r.filename}</div> : <img src={r.image} alt={r.filename} className="h-full w-full object-cover" />}
                  </div>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{r.vendor || r.filename}</p>
                        <p className="text-sm text-slate-500">{r.date} • {r.brand}</p>
                        {r.note ? <p className="mt-2 text-sm">{r.note}</p> : null}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeItem('receipts', r.id, 'receipts')}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="inventory" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader><CardTitle>Add inventory item</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div><Label>SKU</Label><Input value={inventoryForm.sku} onChange={(e) => setInventoryForm({ ...inventoryForm, sku: e.target.value })} /></div>
                  <div><Label>Brand</Label><Select value={inventoryForm.brand} onValueChange={(v) => setInventoryForm({ ...inventoryForm, brand: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SETTINGS.brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
                  <div className="md:col-span-2"><Label>Name</Label><Input value={inventoryForm.name} onChange={(e) => setInventoryForm({ ...inventoryForm, name: e.target.value })} /></div>
                  <div><Label>Unit</Label><Input value={inventoryForm.unit} onChange={(e) => setInventoryForm({ ...inventoryForm, unit: e.target.value })} /></div>
                  <div><Label>Qty on hand</Label><Input type="number" value={inventoryForm.qtyOnHand} onChange={(e) => setInventoryForm({ ...inventoryForm, qtyOnHand: e.target.value })} /></div>
                  <div><Label>Reorder level</Label><Input type="number" value={inventoryForm.reorderLevel} onChange={(e) => setInventoryForm({ ...inventoryForm, reorderLevel: e.target.value })} /></div>
                  <div><Label>Avg cost</Label><Input type="number" value={inventoryForm.avgCost} onChange={(e) => setInventoryForm({ ...inventoryForm, avgCost: e.target.value })} /></div>
                  <div className="md:col-span-2"><Button onClick={addInventoryItem}><Plus className="mr-2 h-4 w-4" />Add Item</Button></div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader><CardTitle>Inventory movement</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div><Label>Date</Label><Input type="date" value={moveForm.date} onChange={(e) => setMoveForm({ ...moveForm, date: e.target.value })} /></div>
                  <div><Label>Type</Label><Select value={moveForm.type} onValueChange={(v) => setMoveForm({ ...moveForm, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in">Stock In</SelectItem><SelectItem value="out">Usage / Out</SelectItem><SelectItem value="waste">Waste</SelectItem><SelectItem value="adjustment">Adjustment</SelectItem></SelectContent></Select></div>
                  <div className="md:col-span-2"><Label>Item</Label><Select value={moveForm.itemId} onValueChange={(v) => setMoveForm({ ...moveForm, itemId: v })}><SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{data.inventoryItems.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.brand})</SelectItem>)}</SelectContent></Select></div>
                  <div><Label>Qty</Label><Input type="number" value={moveForm.qty} onChange={(e) => setMoveForm({ ...moveForm, qty: e.target.value })} /></div>
                  <div><Label>Unit cost</Label><Input type="number" value={moveForm.unitCost} onChange={(e) => setMoveForm({ ...moveForm, unitCost: e.target.value })} /></div>
                  <div className="md:col-span-2"><Label>Note</Label><Textarea value={moveForm.note} onChange={(e) => setMoveForm({ ...moveForm, note: e.target.value })} /></div>
                  <div className="md:col-span-2"><Button onClick={addInventoryMove}><Plus className="mr-2 h-4 w-4" />Add Movement</Button></div>
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Inventory list</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {data.inventoryItems.map((i) => (
                  <RowShell key={i.id}>
                    <div>
                      <div className="flex flex-wrap gap-2"><Badge variant="outline">{i.brand}</Badge><Badge variant="secondary">{i.sku || 'No SKU'}</Badge></div>
                      <p className="mt-2 font-medium">{i.name}</p>
                      <p className="text-sm text-slate-500">On hand {i.qtyOnHand} {i.unit} • Reorder {i.reorderLevel} • Avg cost {MYR.format(Number(i.avgCost || 0))}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeItem('inventoryItems', i.id, 'inventory_items')}><Trash2 className="h-4 w-4" /></Button>
                  </RowShell>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pnl" className="space-y-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>P&amp;L by month</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {pnlRows.map((r) => (
                  <RowShell key={`${r.month}-${r.brand}`}>
                    <div>
                      <div className="flex flex-wrap gap-2"><Badge variant="outline">{r.month}</Badge><Badge variant="outline">{r.brand}</Badge></div>
                      <p className="mt-2 text-sm text-slate-500">Sales {MYR.format(r.income)} • Expense {MYR.format(r.expense)} • COGS {MYR.format(r.cogs)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-500">Gross {MYR.format(r.gross)}</p>
                      <p className="text-lg font-semibold">Net {MYR.format(r.net)}</p>
                    </div>
                  </RowShell>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="setup" className="space-y-4">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Supabase setup</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm leading-6 text-slate-700">
                <p>1. Create Supabase project.</p>
                <p>2. Add env vars: <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code>.</p>
                <p>3. Create tables: <code>transactions</code>, <code>receipts</code>, <code>inventory_items</code>, <code>inventory_moves</code>.</p>
                <p>4. Turn on Row Level Security dan buat policies ikut user/team nanti.</p>
                <p>5. Untuk resit image besar, boleh upgrade ke Supabase Storage. Sekarang prototype simpan image base64 untuk demo cepat.</p>
                <p>6. Partner boleh buka dashboard yang sama dan tengok live bila mode cloud aktif.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
