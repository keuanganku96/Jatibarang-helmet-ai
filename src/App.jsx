import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured } from "./supabase.js";

const money = value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);
const BUSINESS_ID = "8552ecbe-a62e-41b9-b274-b855f6b5e37b";
const NAV = [["Dashboard","▦"],["Kasir","▣"],["Produk & Stok","▤"],["Pelanggan","♙"],["Laporan","▥"],["Pengaturan","⚙"]];

function Login({ onLogin }) {
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    const { error } = await onLogin(email.trim(), password);
    if (error) setError(error.message || "Tidak dapat masuk. Periksa email dan kata sandi.");
    setBusy(false);
  }
  return <main className="auth-screen"><form className="auth-card" onSubmit={submit}>
    <div className="brand-mark auth-mark">SJ</div><span className="eyebrow">JATIBARANG HELMET</span>
    <h1>SMART POS</h1><p>Masuk untuk mengelola toko dan transaksi Anda.</p>
    <label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email akun Anda"/></label>
    <label>Kata sandi<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Kata sandi"/></label>
    {error&&<div className="notice error-notice">{error}</div>}
    <button className="primary full" disabled={busy}>{busy?"Memeriksa...":"Masuk ke aplikasi"}</button>
    <small>Akun Owner yang sudah terdaftar di Supabase digunakan untuk masuk.</small>
  </form></main>;
}

export default function App() {
  const [session,setSession] = useState(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [page,setPage] = useState("Dashboard");
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const [error,setError] = useState("");
  const [business,setBusiness] = useState(null);
  const [membership,setMembership] = useState(null);
  const [branches,setBranches] = useState([]);
  const [warehouses,setWarehouses] = useState([]);
  const [branchId,setBranchId] = useState("");
  const [warehouseId,setWarehouseId] = useState("");
  const [products,setProducts] = useState([]);
  const [customers,setCustomers] = useState([]);
  const [sales,setSales] = useState([]);
  const [cart,setCart] = useState([]);
  const [search,setSearch] = useState("");
  const [payment,setPayment] = useState("Tunai");
  const [customerId,setCustomerId] = useState("");
  const [showProductForm,setShowProductForm] = useState(false);
  const [showCustomerForm,setShowCustomerForm] = useState(false);
  const [productForm,setProductForm] = useState({name:"",sku:"",barcode:"",category:"Helm",unit:"pcs",cost_price:"",selling_price:"",min_stock:"3",initial_quantity:"0"});
  const [customerForm,setCustomerForm] = useState({name:"",phone:"",email:"",address:""});

  useEffect(()=>{
    if (!supabaseConfigured || !supabase) { setAuthLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({data})=>{ if(alive){setSession(data.session);setAuthLoading(false);} });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);setAuthLoading(false);});
    return ()=>{alive=false;subscription.unsubscribe();};
  },[]);

  const loadData = useCallback(async () => {
    if (!session?.user?.id || !supabase) return;
    setBusy(true); setError("");
    try {
      const {data:member,error:memberError} = await supabase.from("business_members")
        .select("business_id,role,branch_id").eq("user_id",session.user.id).eq("is_active",true).limit(1).maybeSingle();
      if(memberError) throw memberError;
      if(!member) throw new Error("Akun ini belum terdaftar sebagai anggota bisnis. Hubungi Owner.");
      const businessId = member.business_id;
      const [bizRes,branchRes,warehouseRes,productRes,inventoryRes,categoryRes,customerRes,salesRes] = await Promise.all([
        supabase.from("businesses").select("id,name,currency,timezone").eq("id",businessId).single(),
        supabase.from("branches").select("id,name,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("warehouses").select("id,name,branch_id,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("products").select("id,business_id,category_id,sku,barcode,name,unit,cost_price,selling_price,min_stock,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("inventory").select("product_id,warehouse_id,quantity").eq("business_id",businessId),
        supabase.from("categories").select("id,name").eq("business_id",businessId).order("name"),
        supabase.from("customers").select("id,name,phone,email,address").eq("business_id",businessId).order("name"),
        supabase.from("sales").select("id,invoice_no,status,total,created_at,customer_id,sale_items(quantity)").eq("business_id",businessId).order("created_at",{ascending:false}).limit(100)
      ]);
      for(const result of [bizRes,branchRes,warehouseRes,productRes,inventoryRes,categoryRes,customerRes,salesRes]) if(result.error) throw result.error;
      const activeBranch = branchRes.data.find(b=>b.id===member.branch_id) || branchRes.data[0];
      const activeWarehouse = warehouseRes.data.find(w=>w.branch_id===activeBranch?.id) || warehouseRes.data[0];
      const categoryMap = Object.fromEntries(categoryRes.data.map(c=>[c.id,c.name]));
      // Show stock for the selected operating warehouse only; never combine stock
      // from separate branches/warehouses into one sellable quantity.
      const stockMap = {};
      for(const row of inventoryRes.data) {
        if(row.warehouse_id === activeWarehouse?.id) {
          stockMap[row.product_id] = Number(row.quantity || 0);
        }
      }
      setBusiness(bizRes.data); setMembership(member); setBranches(branchRes.data); setWarehouses(warehouseRes.data);
      setBranchId(activeBranch?.id||""); setWarehouseId(activeWarehouse?.id||"");
      setProducts(productRes.data.map(p=>({...p,category:categoryMap[p.category_id]||"Umum",stock:stockMap[p.id]||0,price:Number(p.selling_price),cost:Number(p.cost_price),min:Number(p.min_stock)})));
      setCustomers(customerRes.data); setSales(salesRes.data);
    } catch(e) { setError(e.message||"Gagal memuat data toko."); }
    finally { setBusy(false); }
  },[session]);

  useEffect(()=>{ if(session) loadData(); },[session,loadData]);

  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(""),3500);return()=>clearTimeout(timer);},[notice]);

  async function login(email,password){return await supabase.auth.signInWithPassword({email,password});}
  async function logout(){await supabase.auth.signOut();setBusiness(null);setProducts([]);setCustomers([]);setSales([]);setCart([]);}

  const filteredProducts = useMemo(()=>products.filter(p=>(p.name+" "+(p.sku||"")+" "+p.category).toLowerCase().includes(search.toLowerCase())),[products,search]);
  const cartTotal = cart.reduce((sum,item)=>sum+item.price*item.qty,0);
  const todayKey = new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"});
  const todaySales = sales.filter(s=>new Date(s.created_at).toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"})===todayKey);
  const revenue = todaySales.reduce((sum,s)=>sum+Number(s.total),0);
  const lowStock = products.filter(p=>p.stock>0&&p.stock<=p.min).length;
  const outStock = products.filter(p=>p.stock<=0).length;

  function addCart(product){
    if(!product||product.stock<=0){setNotice("Stok produk habis.");return;}
    setCart(old=>{const found=old.find(x=>x.id===product.id);if(found){if(found.qty>=product.stock){setNotice("Jumlah melebihi stok tersedia.");return old;}return old.map(x=>x.id===product.id?{...x,qty:x.qty+1}:x);}return [...old,{...product,qty:1}];});
  }

  async function checkout(){
    if(!cart.length||!warehouseId||!branchId)return;
    setBusy(true);setError("");
    const {data,error:checkoutError}=await supabase.rpc("checkout_sale",{
      p_business_id:business.id,p_branch_id:branchId,p_warehouse_id:warehouseId,
      p_customer_id:customerId||null,p_items:cart.map(item=>({product_id:item.id,quantity:item.qty})),
      p_payment_method:payment
    });
    if(checkoutError){setError(checkoutError.message);setBusy(false);return;}
    setCart([]);setCustomerId("");setNotice("Transaksi "+(data?.[0]?.invoice_no||"") +" berhasil disimpan ke database.");
    await loadData();
  }

  async function saveProduct(e){
    e.preventDefault();setBusy(true);setError("");
    const {error:saveError}=await supabase.rpc("create_product_with_stock",{
      p_business_id:business.id,p_branch_id:branchId,p_warehouse_id:warehouseId,
      p_name:productForm.name,p_sku:productForm.sku,p_barcode:productForm.barcode,
      p_category:productForm.category,p_unit:productForm.unit,
      p_cost_price:Number(productForm.cost_price)||0,p_selling_price:Number(productForm.selling_price)||0,
      p_min_stock:Number(productForm.min_stock)||0,p_initial_quantity:Number(productForm.initial_quantity)||0
    });
    setBusy(false);
    if(saveError){setError(saveError.message);return;}
    setShowProductForm(false);setProductForm({name:"",sku:"",barcode:"",category:"Helm",unit:"pcs",cost_price:"",selling_price:"",min_stock:"3",initial_quantity:"0"});
    setNotice("Produk dan stok awal tersimpan.");await loadData();
  }

  async function saveCustomer(e){
    e.preventDefault();setBusy(true);setError("");
    const {error:saveError}=await supabase.from("customers").insert({business_id:business.id,name:customerForm.name.trim(),phone:customerForm.phone||null,email:customerForm.email||null,address:customerForm.address||null});
    setBusy(false);if(saveError){setError(saveError.message);return;}
    setShowCustomerForm(false);setCustomerForm({name:"",phone:"",email:"",address:""});setNotice("Pelanggan berhasil ditambahkan.");await loadData();
  }

  const card=(label,value,sub,icon)=><div className="stat"><span className="stat-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong><span className="muted">{sub}</span></div></div>;

  if(!supabaseConfigured)return <main className="auth-screen"><div className="auth-card"><h1>SMART POS JATIBARANG</h1><p>Koneksi Supabase belum dikonfigurasi pada deployment ini. Periksa Vercel Environment Variables lalu deploy ulang.</p></div></main>;
  if(authLoading)return <main className="auth-screen"><div className="auth-card">Memeriksa sesi akun...</div></main>;
  if(!session)return <Login onLogin={login}/>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">SJ</div><div><b>SMART POS</b><small>JATIBARANG HELMET</small></div></div>
      <div className="side-label">MENU UTAMA</div>{NAV.map(([name,icon])=><button key={name} className={page===name?"side-link active":"side-link"} onClick={()=>setPage(name)}><span>{icon}</span>{name}</button>)}
      <div className="side-bottom"><span className="status-dot"></span> Terhubung ke cloud<small>{business?.name||"Memuat bisnis..."}</small></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><b>{page}</b><small>{business?.name||"Jatibarang Helmet"} · {branches.find(b=>b.id===branchId)?.name||"Cabang"}</small></div>
        <div className="top-right"><span className="online"><i/> Sinkronisasi cloud</span><div className="avatar">{(session.user.email||"JH").slice(0,2).toUpperCase()}</div><button className="secondary" onClick={logout}>Keluar</button></div>
      </header>
      <div className="content">
        {notice&&<div className="notice">{notice}<button onClick={()=>setNotice("")}>×</button></div>}
        {error&&<div className="notice error-notice">{error}<button onClick={()=>setError("")}>×</button></div>}
        {busy&&<div className="sync-line">Memproses data aman di Supabase...</div>}
        {page==="Dashboard"&&<><div className="welcome"><div><span className="eyebrow">RINGKASAN TOKO</span><h1>Selamat datang 👋</h1><p>Pantau aktivitas penjualan dan persediaan toko hari ini.</p></div><button className="primary" onClick={()=>setPage("Kasir")}>＋ Transaksi baru</button></div>
          <div className="stats">{card("Penjualan hari ini",money(revenue),todaySales.length+" transaksi","↗")}{card("Total produk",products.length+" item","Produk terdaftar","▤")}{card("Stok menipis",lowStock+" item","Perlu segera restock","⚠")}{card("Stok habis",outStock+" item","Tidak dapat dijual","⊘")}</div>
          <div className="grid-two"><section className="panel"><div className="panel-head"><div><h3>Transaksi terbaru</h3><p>Riwayat penjualan tersimpan di cloud</p></div><button className="text-btn" onClick={()=>setPage("Laporan")}>Lihat semua →</button></div>
            {sales.length===0?<div className="empty">Belum ada transaksi.</div>:<div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>STATUS</th><th>TANGGAL</th><th>TOTAL</th></tr></thead><tbody>{sales.slice(0,6).map(s=><tr key={s.id}><td>{s.invoice_no}</td><td><span className="badge green">{s.status}</span></td><td>{new Date(s.created_at).toLocaleString("id-ID")}</td><td className="amount">{money(s.total)}</td></tr>)}</tbody></table></div>}</section>
            <section className="panel"><div className="panel-head"><div><h3>Perhatian stok</h3><p>Produk yang perlu dipantau</p></div><button className="text-btn" onClick={()=>setPage("Produk & Stok")}>Kelola →</button></div>
              {products.filter(p=>p.stock<=p.min).length===0?<div className="empty">Semua stok aman.</div>:products.filter(p=>p.stock<=p.min).map(p=><div className="stock-row" key={p.id}><div><b>{p.name}</b><small>{p.sku||"Tanpa SKU"}</small></div><span className={p.stock===0?"badge red":"badge yellow"}>{p.stock===0?"Habis":p.stock+" tersisa"}</span></div>)}</section></div></>}
        {page==="Kasir"&&<><div className="welcome"><div><span className="eyebrow">POINT OF SALE</span><h1>Kasir</h1><p>Transaksi langsung tercatat ke database cloud.</p></div></div>
          <div className="pos-layout"><section className="panel"><div className="searchbar"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari nama produk, SKU, atau barcode..."/></div>
            <div className="product-grid">{filteredProducts.map(p=><button className="product-tile" key={p.id} onClick={()=>addCart(p)} disabled={p.stock<=0}><span className="product-symbol">◇</span><b>{p.name}</b><small>{p.sku||"Tanpa SKU"} · Stok {p.stock}</small><strong>{money(p.price)}</strong></button>)}</div>
            {filteredProducts.length===0&&<div className="empty">Belum ada produk. Tambahkan produk melalui menu Produk & Stok.</div>}</section>
            <section className="panel cart-panel"><div className="panel-head"><div><h3>Keranjang</h3><p>{cart.reduce((a,c)=>a+c.qty,0)} item dipilih</p></div><button className="text-btn" onClick={()=>setCart([])}>Kosongkan</button></div>
              {cart.length===0?<div className="empty">Keranjang masih kosong.</div>:cart.map(item=><div className="cart-row" key={item.id}><div><b>{item.name}</b><small>{money(item.price)} / item</small></div><div className="qty"><button onClick={()=>setCart(old=>old.map(x=>x.id===item.id?{...x,qty:x.qty-1}:x).filter(x=>x.qty>0))}>−</button>{item.qty}<button onClick={()=>addCart(products.find(p=>p.id===item.id))}>＋</button></div></div>)}
              <div className="checkout-fields"><label>Pelanggan<select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">Pelanggan umum</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label>Metode pembayaran<select value={payment} onChange={e=>setPayment(e.target.value)}><option>Tunai</option><option>Transfer bank</option><option>QRIS</option><option>Debit</option></select></label></div>
              <div className="total-line"><span>Total</span><strong>{money(cartTotal)}</strong></div><button className="primary full" disabled={!cart.length||busy||!warehouseId} onClick={checkout}>Selesaikan transaksi</button>
            </section></div></>}
        {page==="Produk & Stok"&&<><div className="welcome"><div><span className="eyebrow">INVENTARIS</span><h1>Produk & Stok</h1><p>Katalog dan jumlah stok dari gudang Supabase.</p></div><button className="primary" onClick={()=>setShowProductForm(v=>!v)}>＋ Tambah produk</button></div>
          {showProductForm&&<form className="panel form-grid" onSubmit={saveProduct}><label>Nama produk<input required value={productForm.name} onChange={e=>setProductForm({...productForm,name:e.target.value})}/></label><label>SKU<input value={productForm.sku} onChange={e=>setProductForm({...productForm,sku:e.target.value})}/></label><label>Barcode<input value={productForm.barcode} onChange={e=>setProductForm({...productForm,barcode:e.target.value})}/></label><label>Kategori<input value={productForm.category} onChange={e=>setProductForm({...productForm,category:e.target.value})}/></label><label>Harga modal<input type="number" min="0" required value={productForm.cost_price} onChange={e=>setProductForm({...productForm,cost_price:e.target.value})}/></label><label>Harga jual<input type="number" min="0" required value={productForm.selling_price} onChange={e=>setProductForm({...productForm,selling_price:e.target.value})}/></label><label>Stok minimum<input type="number" min="0" value={productForm.min_stock} onChange={e=>setProductForm({...productForm,min_stock:e.target.value})}/></label><label>Stok awal<input type="number" min="0" value={productForm.initial_quantity} onChange={e=>setProductForm({...productForm,initial_quantity:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan produk</button><button type="button" className="secondary" onClick={()=>setShowProductForm(false)}>Batal</button></div></form>}
          <section className="panel"><div className="searchbar"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari produk..."/></div><div className="table-wrap"><table><thead><tr><th>PRODUK</th><th>SKU</th><th>KATEGORI</th><th>HARGA JUAL</th><th>STOK</th><th>STATUS</th></tr></thead><tbody>{filteredProducts.map(p=><tr key={p.id}><td><b>{p.name}</b></td><td>{p.sku||"—"}</td><td>{p.category}</td><td>{money(p.price)}</td><td>{p.stock}</td><td><span className={p.stock<=0?"badge red":p.stock<=p.min?"badge yellow":"badge green"}>{p.stock<=0?"Habis":p.stock<=p.min?"Menipis":"Aman"}</span></td></tr>)}</tbody></table></div>{products.length===0&&<div className="empty">Belum ada produk di database.</div>}</section></>}
        {page==="Pelanggan"&&<><div className="welcome"><div><span className="eyebrow">CRM</span><h1>Pelanggan</h1><p>Data pelanggan tersimpan di cloud.</p></div><button className="primary" onClick={()=>setShowCustomerForm(v=>!v)}>＋ Tambah pelanggan</button></div>
          {showCustomerForm&&<form className="panel form-grid" onSubmit={saveCustomer}><label>Nama pelanggan<input required value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/></label><label>Nomor telepon<input value={customerForm.phone} onChange={e=>setCustomerForm({...customerForm,phone:e.target.value})}/></label><label>Email<input type="email" value={customerForm.email} onChange={e=>setCustomerForm({...customerForm,email:e.target.value})}/></label><label>Alamat<input value={customerForm.address} onChange={e=>setCustomerForm({...customerForm,address:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pelanggan</button></div></form>}
          <section className="panel"><div className="table-wrap"><table><thead><tr><th>NAMA</th><th>TELEPON</th><th>EMAIL</th><th>ALAMAT</th></tr></thead><tbody>{customers.map(c=><tr key={c.id}><td><b>{c.name}</b></td><td>{c.phone||"—"}</td><td>{c.email||"—"}</td><td>{c.address||"—"}</td></tr>)}</tbody></table></div>{customers.length===0&&<div className="empty">Belum ada data pelanggan.</div>}</section></>}
        {page==="Laporan"&&<><div className="welcome"><div><span className="eyebrow">ANALITIK</span><h1>Laporan Penjualan</h1><p>Transaksi yang tercatat pada database.</p></div><button className="secondary" onClick={()=>{const rows=[["Invoice","Status","Tanggal","Total"],...sales.map(s=>[s.invoice_no,s.status,s.created_at,s.total])];const csv=rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.download="laporan-smart-pos.csv";a.click();URL.revokeObjectURL(a.href);}}>↓ Ekspor CSV</button></div>
          <div className="stats">{card("Total transaksi",sales.length,"Data cloud","▣")}{card("Total penjualan",money(sales.reduce((a,s)=>a+Number(s.total),0)),"Semua waktu","↗")}{card("Penjualan hari ini",money(revenue),todayKey,"▦")}{card("Rata-rata transaksi",money(sales.length?sales.reduce((a,s)=>a+Number(s.total),0)/sales.length:0),"Per transaksi","◷")}</div>
          <section className="panel"><div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>TANGGAL</th><th>STATUS</th><th>JUMLAH ITEM</th><th>TOTAL</th></tr></thead><tbody>{sales.map(s=><tr key={s.id}><td>{s.invoice_no}</td><td>{new Date(s.created_at).toLocaleString("id-ID")}</td><td>{s.status}</td><td>{(s.sale_items||[]).reduce((n,item)=>n+Number(item.quantity),0)}</td><td className="amount">{money(s.total)}</td></tr>)}</tbody></table></div>{sales.length===0&&<div className="empty">Belum ada transaksi.</div>}</section></>}
        {page==="Pengaturan"&&<><div className="welcome"><div><span className="eyebrow">KONFIGURASI</span><h1>Pengaturan</h1><p>Informasi koneksi dan lokasi operasional.</p></div></div><section className="panel settings"><h3>{business?.name}</h3><p>SMART POS JATIBARANG</p><div className="setting-row"><span>Akun aktif</span><b>{session.user.email}</b></div><div className="setting-row"><span>Peran</span><b>{membership?.role}</b></div><div className="setting-row"><span>Cabang</span><b>{branches.find(b=>b.id===branchId)?.name||"—"}</b></div><div className="setting-row"><span>Gudang</span><b>{warehouses.find(w=>w.id===warehouseId)?.name||"—"}</b></div><div className="setting-row"><span>Penyimpanan</span><b className="badge green">Supabase Cloud</b></div><div className="setting-row"><span>Sinkronisasi</span><b className="badge green">Aktif</b></div><p className="warning-note">Transaksi kasir menggunakan prosedur database atomik agar penjualan, pembayaran, kas, dan pengurangan stok tercatat bersama-sama.</p><button className="secondary" onClick={loadData}>↻ Segarkan data</button></section></>}
        <footer>SMART POS JATIBARANG · Data tersimpan di Supabase Cloud</footer>
      </div>
    </main>
  </div>;
}
