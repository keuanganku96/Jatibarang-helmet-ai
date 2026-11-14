import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfigured } from "./supabase.js";

const money = value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);
const BUSINESS_ID = "8552ecbe-a62e-41b9-b274-b855f6b5e37b";
const NAV = [["Dashboard","▦"],["Kasir","▣"],["Produk & Stok","▤"],["Pembelian","⇧"],["Pemasok","♧"],["Pelanggan","♙"],["Laporan","▥"],["Keuangan","Rp"],["Pengaturan","⚙"]];

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
  const [suppliers,setSuppliers] = useState([]);
  const [purchases,setPurchases] = useState([]);
  const [sales,setSales] = useState([]);
  const [cashEntries,setCashEntries] = useState([]);
  const [expenseForm,setExpenseForm] = useState({category:"Operasional",description:"",amount:""});
  const [cart,setCart] = useState([]);
  const [search,setSearch] = useState("");
  const [continuousScan,setContinuousScan] = useState(true);
  const [customerScan,setCustomerScan] = useState("");
  const [payment,setPayment] = useState("Tunai");
  const [customerId,setCustomerId] = useState("");
  const [showProductForm,setShowProductForm] = useState(false);
  const [showCustomerForm,setShowCustomerForm] = useState(false);
  const [productForm,setProductForm] = useState({name:"",sku:"",barcode:"",category:"Helm",unit:"pcs",cost_price:"",selling_price:"",discount_type:"none",discount_value:"0",min_stock:"3",initial_quantity:"0"});
  const [customerForm,setCustomerForm] = useState({name:"",phone:"",email:"",address:""});
  const [showSupplierForm,setShowSupplierForm] = useState(false);
  const [supplierForm,setSupplierForm] = useState({name:"",phone:"",email:"",address:""});
  const [purchaseForm,setPurchaseForm] = useState({supplier_id:"",notes:"",product_id:"",quantity:"1",unit_cost:""});
  const [purchaseCart,setPurchaseCart] = useState([]);

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
      const [bizRes,branchRes,warehouseRes,productRes,inventoryRes,categoryRes,customerRes,salesRes,suppliersRes,purchasesRes,cashRes] = await Promise.all([
        supabase.from("businesses").select("id,name,currency,timezone").eq("id",businessId).single(),
        supabase.from("branches").select("id,name,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("warehouses").select("id,name,branch_id,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("products").select("id,business_id,category_id,sku,barcode,name,unit,cost_price,selling_price,min_stock,discount_type,discount_value,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("inventory").select("product_id,warehouse_id,quantity").eq("business_id",businessId),
        supabase.from("categories").select("id,name").eq("business_id",businessId).order("name"),
        supabase.from("customers").select("id,name,customer_code,phone,email,address").eq("business_id",businessId).order("name"),
        (branchId ? supabase.from("sales").select("id,invoice_no,status,total,created_at,customer_id,sale_items(quantity)").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("sales").select("id,invoice_no,status,total,created_at,customer_id,sale_items(quantity)").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(100),
        supabase.from("suppliers").select("id,name,phone,email,address").eq("business_id",businessId).order("name"),
        (branchId ? supabase.from("purchase_orders").select("id,purchase_no,status,total,created_at,suppliers(name),purchase_items(quantity)").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("purchase_orders").select("id,purchase_no,status,total,created_at,suppliers(name),purchase_items(quantity)").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(100),
        (branchId ? supabase.from("cash_entries").select("id,entry_type,category,description,amount,created_at,reference_type").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("cash_entries").select("id,entry_type,category,description,amount,created_at,reference_type").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(200)
      ]);
      for(const result of [bizRes,branchRes,warehouseRes,productRes,inventoryRes,categoryRes,customerRes,salesRes,suppliersRes,purchasesRes,cashRes]) if(result.error) throw result.error;
      // Owner/Admin may switch across active branches. Other roles remain
      // restricted to the branch assigned to their membership.
      const accessibleBranches = ["owner","admin"].includes(member.role)
        ? branchRes.data
        : branchRes.data.filter(b=>b.id===member.branch_id);
      const activeBranch = accessibleBranches.find(b=>b.id===branchId)
        || accessibleBranches.find(b=>b.id===member.branch_id)
        || accessibleBranches[0];
      const branchWarehouses = warehouseRes.data.filter(w=>w.branch_id===activeBranch?.id);
      const activeWarehouse = branchWarehouses.find(w=>w.id===warehouseId) || branchWarehouses[0];
      const categoryMap = Object.fromEntries(categoryRes.data.map(c=>[c.id,c.name]));
      // Show stock for the selected operating warehouse only; never combine stock
      // from separate branches/warehouses into one sellable quantity.
      const stockMap = {};
      for(const row of inventoryRes.data) {
        if(row.warehouse_id === activeWarehouse?.id) {
          stockMap[row.product_id] = Number(row.quantity || 0);
        }
      }
      setBusiness(bizRes.data); setMembership(member); setBranches(accessibleBranches); setWarehouses(warehouseRes.data);
      setBranchId(activeBranch?.id||""); setWarehouseId(activeWarehouse?.id||"");
      setProducts(productRes.data.map(p=>({...p,category:categoryMap[p.category_id]||"Umum",stock:stockMap[p.id]||0,price:Number(p.selling_price),cost:Number(p.cost_price),min:Number(p.min_stock),discountType:p.discount_type||"none",discountValue:Number(p.discount_value)||0})));
      setCustomers(customerRes.data); setSales(salesRes.data);
      setSuppliers(suppliersRes.data); setPurchases(purchasesRes.data); setCashEntries(cashRes.data||[]);
    } catch(e) { setError(e.message||"Gagal memuat data toko."); }
    finally { setBusy(false); }
  },[session,branchId,warehouseId]);

  useEffect(()=>{ if(session) loadData(); },[session,loadData]);

  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(""),3500);return()=>clearTimeout(timer);},[notice]);

  async function login(email,password){return await supabase.auth.signInWithPassword({email,password});}
  async function logout(){await supabase.auth.signOut();setBusiness(null);setProducts([]);setCustomers([]);setSales([]);setCart([]);}

  const filteredProducts = useMemo(()=>products.filter(p=>(p.name+" "+(p.sku||"")+" "+p.category).toLowerCase().includes(search.toLowerCase())),[products,search]);
  const cartSubtotal = cart.reduce((sum,item)=>sum+item.price*item.qty,0);
  const cartDiscount = cart.reduce((sum,item)=>sum+(Number(item.discountAmount)||0),0);
  const cartTotal = Math.max(0,cartSubtotal-cartDiscount);
  const todayKey = new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"});
  const todaySales = sales.filter(s=>new Date(s.created_at).toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"})===todayKey);
  const revenue = todaySales.reduce((sum,s)=>sum+Number(s.total),0);
  const lowStock = products.filter(p=>p.stock>0&&p.stock<=p.min).length;
  const outStock = products.filter(p=>p.stock<=0).length;

  function addCart(product){
    if(!product||product.stock<=0){setNotice("Stok produk habis.");return;}
    const unitDiscount=product.discountType==="percent"?product.price*product.discountValue/100:product.discountType==="fixed"?Math.min(product.price,product.discountValue):0;
    setCart(old=>{const found=old.find(x=>x.id===product.id);if(found){if(found.qty>=product.stock){setNotice("Jumlah melebihi stok tersedia.");return old;}return old.map(x=>x.id===product.id?{...x,qty:x.qty+1,discountAmount:(Number(x.discountAmount)||0)+unitDiscount}:x);}return [...old,{...product,qty:1,discountAmount:unitDiscount}];});
  }

  function scanProduct(e){
    if(e.key!=="Enter")return;
    e.preventDefault();
    const code=search.trim().toLowerCase();
    if(!code)return;
    const match=products.find(p=>(p.barcode||"").toLowerCase()===code||(p.sku||"").toLowerCase()===code);
    if(match){addCart(match);setNotice("Barcode "+(match.barcode||match.sku)+" ditambahkan: "+match.name);setSearch("");if(continuousScan)setTimeout(()=>document.getElementById("pos-barcode-input")?.focus(),50);}
    else setNotice("Barcode/SKU tidak ditemukan: "+search);
  }

  function scanCustomer(e){
    if(e.key!=="Enter")return;
    e.preventDefault();
    const code=customerScan.trim().toLowerCase();
    const found=customers.find(c=>(c.customer_code||"").toLowerCase()===code||c.id.toLowerCase()===code);
    if(found){setCustomerId(found.id);setNotice("Pelanggan ditemukan: "+found.name);setCustomerScan("");}
    else setNotice("ID pelanggan tidak ditemukan.");
  }

  async function checkout(){
    if(!cart.length||!warehouseId||!branchId)return;
    setBusy(true);setError("");
    const {data,error:checkoutError}=await supabase.rpc("checkout_sale",{
      p_business_id:business.id,p_branch_id:branchId,p_warehouse_id:warehouseId,
      p_customer_id:customerId||null,p_items:cart.map(item=>({product_id:item.id,quantity:item.qty,discount_amount:Number(item.discountAmount)||0})),
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
    setShowProductForm(false);setProductForm({name:"",sku:"",barcode:"",category:"Helm",unit:"pcs",cost_price:"",selling_price:"",discount_type:"none",discount_value:"0",min_stock:"3",initial_quantity:"0"});
    setNotice("Produk dan stok awal tersimpan.");await loadData();
  }

  async function saveCustomer(e){
    e.preventDefault();setBusy(true);setError("");
    const {error:saveError}=await supabase.rpc("create_customer",{p_business_id:business.id,p_name:customerForm.name.trim(),p_phone:customerForm.phone||null,p_email:customerForm.email||null,p_address:customerForm.address||null});
    setBusy(false);if(saveError){setError(saveError.message);return;}
    setShowCustomerForm(false);setCustomerForm({name:"",phone:"",email:"",address:""});setNotice("Pelanggan berhasil ditambahkan.");await loadData();
  }

  async function saveSupplier(e){
    e.preventDefault();setBusy(true);setError("");
    const {error:saveError}=await supabase.rpc("create_supplier",{p_business_id:business.id,p_name:supplierForm.name.trim(),p_phone:supplierForm.phone||null,p_email:supplierForm.email||null,p_address:supplierForm.address||null});
    setBusy(false);if(saveError){setError(saveError.message);return;}
    setShowSupplierForm(false);setSupplierForm({name:"",phone:"",email:"",address:""});setNotice("Pemasok berhasil ditambahkan.");await loadData();
  }

  function addPurchaseItem(){
    const product=products.find(p=>p.id===purchaseForm.product_id);
    const quantity=Number(purchaseForm.quantity), unit_cost=Number(purchaseForm.unit_cost);
    if(!product||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unit_cost)||unit_cost<0){setError("Pilih produk dan isi jumlah serta harga modal dengan benar.");return;}
    if(purchaseCart.some(item=>item.product_id===product.id)){setError("Produk tersebut sudah ada di daftar pembelian.");return;}
    setPurchaseCart(old=>[...old,{product_id:product.id,name:product.name,quantity,unit_cost}]);
    setPurchaseForm(old=>({...old,product_id:"",quantity:"1",unit_cost:""}));setError("");
  }

  async function saveExpense(e){
    e.preventDefault();
    if(!business?.id||!branchId)return;
    setBusy(true);setError("");
    const {error:saveError}=await supabase.rpc("record_cash_expense",{
      p_business_id:business.id,p_branch_id:branchId,
      p_category:expenseForm.category,p_description:expenseForm.description,
      p_amount:Number(expenseForm.amount)
    });
    setBusy(false);
    if(saveError){setError(saveError.message);return;}
    setExpenseForm({category:"Operasional",description:"",amount:""});
    setNotice("Pengeluaran berhasil dicatat.");
    await loadData();
  }

  async function savePurchase(){
    if(!purchaseCart.length||!warehouseId)return;
    setBusy(true);setError("");
    const {data,error:saveError}=await supabase.rpc("receive_purchase",{
      p_business_id:business.id,p_branch_id:branchId,p_warehouse_id:warehouseId,
      p_supplier_id:purchaseForm.supplier_id||null,
      p_items:purchaseCart.map(item=>({product_id:item.product_id,quantity:item.quantity,unit_cost:item.unit_cost})),
      p_notes:purchaseForm.notes||null
    });
    setBusy(false);if(saveError){setError(saveError.message);return;}
    setPurchaseCart([]);setPurchaseForm({supplier_id:"",notes:"",product_id:"",quantity:"1",unit_cost:""});
    setNotice("Pembelian "+(data?.[0]?.purchase_no||"")+" diterima; stok gudang bertambah.");await loadData();
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
        <div className="top-right"><div className="location-controls">
          {branches.length>1&&<label><span>Cabang</span><select aria-label="Pilih cabang" value={branchId} onChange={e=>{setBranchId(e.target.value);setWarehouseId("");}}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          {warehouses.filter(w=>w.branch_id===branchId).length>1&&<label><span>Gudang</span><select aria-label="Pilih gudang" value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}>{warehouses.filter(w=>w.branch_id===branchId).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
        </div><span className="online"><i/> Sinkronisasi cloud</span><div className="avatar">{(session.user.email||"JH").slice(0,2).toUpperCase()}</div><button className="secondary" onClick={logout}>Keluar</button></div>
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
          <div className="pos-layout"><section className="panel"><div className="searchbar"><input id="pos-barcode-input" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={scanProduct} placeholder="Scan barcode / cari nama, SKU..."/><label className="scan-toggle"><input type="checkbox" checked={continuousScan} onChange={e=>setContinuousScan(e.target.checked)}/> Continuous scan</label></div>
            <div className="product-grid">{filteredProducts.map(p=><button className="product-tile" key={p.id} onClick={()=>addCart(p)} disabled={p.stock<=0}><span className="product-symbol">◇</span><b>{p.name}</b><small>{p.sku||"Tanpa SKU"} · Stok {p.stock}</small><strong>{money(p.price)}</strong></button>)}</div>
            {filteredProducts.length===0&&<div className="empty">Belum ada produk. Tambahkan produk melalui menu Produk & Stok.</div>}</section>
            <section className="panel cart-panel"><div className="panel-head"><div><h3>Keranjang</h3><p>{cart.reduce((a,c)=>a+c.qty,0)} item dipilih</p></div><button className="text-btn" onClick={()=>setCart([])}>Kosongkan</button></div>
              {cart.length===0?<div className="empty">Keranjang masih kosong.</div>:cart.map(item=><div className="cart-row" key={item.id}><div><b>{item.name}</b><small>{money(item.price)} / item · Diskon {money(item.discountAmount||0)}</small><label className="discount-edit">Diskon total (Rp)<input type="number" min="0" max={item.price*item.qty} value={item.discountAmount||0} onChange={e=>setCart(old=>old.map(x=>x.id===item.id?{...x,discountAmount:Math.min(x.price*x.qty,Math.max(0,Number(e.target.value)||0))}:x))}/></label></div><div className="qty"><button onClick={()=>setCart(old=>old.map(x=>x.id===item.id?{...x,qty:x.qty-1,discountAmount:x.qty>1?Math.min(x.discountAmount||0,x.price*(x.qty-1)):0}:x).filter(x=>x.qty>0))}>−</button>{item.qty}<button onClick={()=>addCart(products.find(p=>p.id===item.id))}>＋</button></div></div>)}
              <div className="checkout-fields"><label>Scan ID pelanggan<input value={customerScan} onChange={e=>setCustomerScan(e.target.value)} onKeyDown={scanCustomer} placeholder="Scan barcode ID member lalu Enter"/></label><label>Pelanggan<select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">Pelanggan umum</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.customer_code||c.id.slice(0,8)}</option>)}</select></label>
                <label>Metode pembayaran<select value={payment} onChange={e=>setPayment(e.target.value)}><option>Tunai</option><option>Transfer bank</option><option>QRIS</option><option>Debit</option></select></label></div>
              <div className="total-line"><span>Subtotal</span><strong>{money(cartSubtotal)}</strong></div><div className="total-line"><span>Diskon</span><strong>− {money(cartDiscount)}</strong></div><div className="total-line"><span>Total bayar</span><strong>{money(cartTotal)}</strong></div><button className="primary full" disabled={!cart.length||busy||!warehouseId} onClick={checkout}>Selesaikan transaksi</button>
            </section></div></>}
        {page==="Produk & Stok"&&<><div className="welcome"><div><span className="eyebrow">INVENTARIS</span><h1>Produk & Stok</h1><p>Katalog dan jumlah stok dari gudang Supabase.</p></div><button className="primary" onClick={()=>setShowProductForm(v=>!v)}>＋ Tambah produk</button></div>
          {showProductForm&&<form className="panel form-grid" onSubmit={saveProduct}><label>Nama produk<input required value={productForm.name} onChange={e=>setProductForm({...productForm,name:e.target.value})}/></label><label>SKU<input value={productForm.sku} onChange={e=>setProductForm({...productForm,sku:e.target.value})}/></label><label>Barcode<input value={productForm.barcode} onChange={e=>setProductForm({...productForm,barcode:e.target.value})}/></label><label>Kategori<input value={productForm.category} onChange={e=>setProductForm({...productForm,category:e.target.value})}/></label><label>Harga modal<input type="number" min="0" required value={productForm.cost_price} onChange={e=>setProductForm({...productForm,cost_price:e.target.value})}/></label><label>Harga jual<input type="number" min="0" required value={productForm.selling_price} onChange={e=>setProductForm({...productForm,selling_price:e.target.value})}/></label><label>Jenis diskon<select value={productForm.discount_type} onChange={e=>setProductForm({...productForm,discount_type:e.target.value})}><option value="none">Tanpa diskon</option><option value="percent">Persentase (%)</option><option value="fixed">Nominal (Rp) per barang</option></select></label><label>Nilai diskon<input type="number" min="0" max={productForm.discount_type==="percent"?100:undefined} value={productForm.discount_value} onChange={e=>setProductForm({...productForm,discount_value:e.target.value})}/></label><label>Stok minimum<input type="number" min="0" value={productForm.min_stock} onChange={e=>setProductForm({...productForm,min_stock:e.target.value})}/></label><label>Stok awal<input type="number" min="0" value={productForm.initial_quantity} onChange={e=>setProductForm({...productForm,initial_quantity:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan produk</button><button type="button" className="secondary" onClick={()=>setShowProductForm(false)}>Batal</button></div></form>}
          <section className="panel"><div className="searchbar"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari produk..."/></div><div className="table-wrap"><table><thead><tr><th>PRODUK</th><th>SKU</th><th>KATEGORI</th><th>HARGA JUAL</th><th>DISKON</th><th>STOK</th><th>STATUS</th></tr></thead><tbody>{filteredProducts.map(p=><tr key={p.id}><td><b>{p.name}</b></td><td>{p.sku||"—"}</td><td>{p.category}</td><td>{money(p.price)}</td><td>{p.discountType==="percent"?p.discountValue+"%":p.discountType==="fixed"?money(p.discountValue):"—"}</td><td>{p.stock}</td><td><span className={p.stock<=0?"badge red":p.stock<=p.min?"badge yellow":"badge green"}>{p.stock<=0?"Habis":p.stock<=p.min?"Menipis":"Aman"}</span></td></tr>)}</tbody></table></div>{products.length===0&&<div className="empty">Belum ada produk di database.</div>}</section></>}
        {page==="Pemasok"&&<><div className="welcome"><div><span className="eyebrow">MITRA TOKO</span><h1>Pemasok</h1><p>Kelola data pemasok untuk pencatatan pembelian.</p></div><button className="primary" onClick={()=>setShowSupplierForm(v=>!v)}>＋ Tambah pemasok</button></div>
          {showSupplierForm&&<form className="panel form-grid" onSubmit={saveSupplier}><label>Nama pemasok<input required value={supplierForm.name} onChange={e=>setSupplierForm({...supplierForm,name:e.target.value})}/></label><label>Nomor telepon<input value={supplierForm.phone} onChange={e=>setSupplierForm({...supplierForm,phone:e.target.value})}/></label><label>Email<input type="email" value={supplierForm.email} onChange={e=>setSupplierForm({...supplierForm,email:e.target.value})}/></label><label>Alamat<input value={supplierForm.address} onChange={e=>setSupplierForm({...supplierForm,address:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pemasok</button><button type="button" className="secondary" onClick={()=>setShowSupplierForm(false)}>Batal</button></div></form>}
          <section className="panel"><div className="table-wrap"><table><thead><tr><th>NAMA PEMASOK</th><th>TELEPON</th><th>EMAIL</th><th>ALAMAT</th></tr></thead><tbody>{suppliers.map(s=><tr key={s.id}><td><b>{s.name}</b></td><td>{s.phone||"—"}</td><td>{s.email||"—"}</td><td>{s.address||"—"}</td></tr>)}</tbody></table></div>{suppliers.length===0&&<div className="empty">Belum ada data pemasok.</div>}</section></>}
        {page==="Pembelian"&&<><div className="welcome"><div><span className="eyebrow">PENGADAAN STOK</span><h1>Pembelian barang</h1><p>Penerimaan barang menambah stok dan mencatat riwayat mutasi secara bersamaan.</p></div></div>
          <section className="panel purchase-panel"><h3>Catat penerimaan pembelian</h3><div className="form-grid"><label>Pemasok<select value={purchaseForm.supplier_id} onChange={e=>setPurchaseForm({...purchaseForm,supplier_id:e.target.value})}><option value="">Pilih pemasok (opsional)</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Catatan<input value={purchaseForm.notes} onChange={e=>setPurchaseForm({...purchaseForm,notes:e.target.value})} placeholder="Nomor nota atau catatan"/></label><label>Produk<select value={purchaseForm.product_id} onChange={e=>{const p=products.find(x=>x.id===e.target.value);setPurchaseForm({...purchaseForm,product_id:e.target.value,unit_cost:p?String(p.cost):""});}}><option value="">Pilih produk</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Jumlah<input type="number" min="0.001" step="0.001" value={purchaseForm.quantity} onChange={e=>setPurchaseForm({...purchaseForm,quantity:e.target.value})}/></label><label>Harga modal per unit<input type="number" min="0" value={purchaseForm.unit_cost} onChange={e=>setPurchaseForm({...purchaseForm,unit_cost:e.target.value})}/></label><div className="form-actions"><button type="button" className="secondary" onClick={addPurchaseItem}>＋ Tambahkan barang</button></div></div>
            {purchaseCart.length>0&&<><div className="table-wrap"><table><thead><tr><th>PRODUK</th><th>JUMLAH</th><th>HARGA MODAL</th><th>SUBTOTAL</th><th></th></tr></thead><tbody>{purchaseCart.map(item=><tr key={item.product_id}><td>{item.name}</td><td>{item.quantity}</td><td>{money(item.unit_cost)}</td><td>{money(item.quantity*item.unit_cost)}</td><td><button className="text-btn" onClick={()=>setPurchaseCart(old=>old.filter(x=>x.product_id!==item.product_id))}>Hapus</button></td></tr>)}</tbody></table></div><div className="total-line"><span>Total pembelian</span><strong>{money(purchaseCart.reduce((a,x)=>a+x.quantity*x.unit_cost,0))}</strong></div><button className="primary" disabled={busy} onClick={savePurchase}>Simpan penerimaan dan tambah stok</button></>}
          </section>
          <section className="panel"><div className="panel-head"><div><h3>Riwayat pembelian</h3><p>100 transaksi pembelian terakhir</p></div></div><div className="table-wrap"><table><thead><tr><th>NOMOR</th><th>PEMASOK</th><th>TANGGAL</th><th>STATUS</th><th>TOTAL</th></tr></thead><tbody>{purchases.map(p=><tr key={p.id}><td>{p.purchase_no}</td><td>{p.suppliers?.name||"—"}</td><td>{new Date(p.created_at).toLocaleString("id-ID")}</td><td><span className="badge green">{p.status}</span></td><td>{money(p.total)}</td></tr>)}</tbody></table></div>{purchases.length===0&&<div className="empty">Belum ada riwayat pembelian.</div>}</section></>}
        {page==="Pelanggan"&&<><div className="welcome"><div><span className="eyebrow">CRM</span><h1>Pelanggan</h1><p>Data pelanggan tersimpan di cloud.</p></div><button className="primary" onClick={()=>setShowCustomerForm(v=>!v)}>＋ Tambah pelanggan</button></div>
          {showCustomerForm&&<form className="panel form-grid" onSubmit={saveCustomer}><label>Nama pelanggan<input required value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/></label><label>Nomor telepon<input value={customerForm.phone} onChange={e=>setCustomerForm({...customerForm,phone:e.target.value})}/></label><label>Email<input type="email" value={customerForm.email} onChange={e=>setCustomerForm({...customerForm,email:e.target.value})}/></label><label>Alamat<input value={customerForm.address} onChange={e=>setCustomerForm({...customerForm,address:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pelanggan</button></div></form>}
          <section className="panel"><div className="table-wrap"><table><thead><tr><th>ID BARCODE</th><th>NAMA</th><th>TELEPON</th><th>EMAIL</th><th>ALAMAT</th></tr></thead><tbody>{customers.map(c=><tr key={c.id}><td><code>{c.customer_code||("JH"+c.id.replaceAll("-","").slice(0,12).toUpperCase())}</code></td><td><b>{c.name}</b></td><td>{c.phone||"—"}</td><td>{c.email||"—"}</td><td>{c.address||"—"}</td></tr>)}</tbody></table></div>{customers.length===0&&<div className="empty">Belum ada data pelanggan.</div>}</section></>}
        {page==="Laporan"&&<><div className="welcome"><div><span className="eyebrow">ANALITIK</span><h1>Laporan Penjualan</h1><p>Transaksi yang tercatat pada database.</p></div><button className="secondary" onClick={()=>{const rows=[["Invoice","Status","Tanggal","Total"],...sales.map(s=>[s.invoice_no,s.status,s.created_at,s.total])];const csv=rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.download="laporan-smart-pos.csv";a.click();URL.revokeObjectURL(a.href);}}>↓ Ekspor CSV</button></div>
          <div className="stats">{card("Total transaksi",sales.length,"Data cloud","▣")}{card("Total penjualan",money(sales.reduce((a,s)=>a+Number(s.total),0)),"Semua waktu","↗")}{card("Penjualan hari ini",money(revenue),todayKey,"▦")}{card("Rata-rata transaksi",money(sales.length?sales.reduce((a,s)=>a+Number(s.total),0)/sales.length:0),"Per transaksi","◷")}</div>
          <section className="panel"><div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>TANGGAL</th><th>STATUS</th><th>JUMLAH ITEM</th><th>TOTAL</th></tr></thead><tbody>{sales.map(s=><tr key={s.id}><td>{s.invoice_no}</td><td>{new Date(s.created_at).toLocaleString("id-ID")}</td><td>{s.status}</td><td>{(s.sale_items||[]).reduce((n,item)=>n+Number(item.quantity),0)}</td><td className="amount">{money(s.total)}</td></tr>)}</tbody></table></div>{sales.length===0&&<div className="empty">Belum ada transaksi.</div>}</section></>}
        {page==="Keuangan"&&<><div className="welcome"><div><span className="eyebrow">FINANCIAL MANAGEMENT</span><h1>Keuangan</h1><p>Ringkasan uang masuk dan pengeluaran yang tercatat di database untuk cabang aktif.</p></div></div>
          <div className="stats">{card("Uang masuk",money(cashEntries.filter(x=>x.entry_type==="income").reduce((a,x)=>a+Number(x.amount),0)),"Maks. 200 catatan terbaru","↗")}{card("Pengeluaran",money(cashEntries.filter(x=>x.entry_type==="expense").reduce((a,x)=>a+Number(x.amount),0)),"Maks. 200 catatan terbaru","↘")}{card("Arus kas bersih",money(cashEntries.reduce((a,x)=>a+(x.entry_type==="income"?1:-1)*Number(x.amount),0)),"Masuk dikurangi keluar","⇄")}{card("Catatan kas",cashEntries.length+" transaksi","Cabang aktif","▤")}</div>
          {["owner","admin","manager"].includes(membership?.role)&&<form className="panel form-grid" onSubmit={saveExpense}><div><h3>Catat pengeluaran</h3><p className="muted">Hanya Owner, Admin, dan Manager yang dapat menyimpan pengeluaran.</p></div><label>Kategori<select value={expenseForm.category} onChange={e=>setExpenseForm({...expenseForm,category:e.target.value})}><option>Operasional</option><option>Transportasi</option><option>Listrik & Air</option><option>Gaji</option><option>Pemasaran</option><option>Perawatan</option><option>Lainnya</option></select></label><label>Keterangan<input required maxLength="500" value={expenseForm.description} onChange={e=>setExpenseForm({...expenseForm,description:e.target.value})} placeholder="Contoh: pembelian perlengkapan toko"/></label><label>Nominal (Rp)<input required type="number" min="1" step="1" value={expenseForm.amount} onChange={e=>setExpenseForm({...expenseForm,amount:e.target.value})} placeholder="100000"/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pengeluaran</button></div></form>}
          <section className="panel"><div className="panel-head"><div><h3>Riwayat kas</h3><p>Uang masuk dari transaksi dan pengeluaran manual</p></div><button className="secondary" onClick={loadData}>↻ Segarkan</button></div><div className="table-wrap"><table><thead><tr><th>TANGGAL</th><th>JENIS</th><th>KATEGORI</th><th>KETERANGAN</th><th>NOMINAL</th></tr></thead><tbody>{cashEntries.map(x=><tr key={x.id}><td>{new Date(x.created_at).toLocaleString("id-ID")}</td><td><span className={x.entry_type==="income"?"badge green":"badge red"}>{x.entry_type==="income"?"Masuk":"Keluar"}</span></td><td>{x.category}</td><td>{x.description}</td><td className="amount">{money(x.amount)}</td></tr>)}</tbody></table></div>{cashEntries.length===0&&<div className="empty">Belum ada catatan kas untuk cabang ini.</div>}</section>
          <p className="warning-note">Catatan: ringkasan ini memakai maksimal 200 catatan terbaru. Pembelian barang yang diterima belum otomatis menjadi pengeluaran kas karena pembayaran pemasok/hutang belum dibangun. Laba-rugi akuntansi belum ditampilkan pada tahap ini.</p></>}
        {page==="Pengaturan"&&<><div className="welcome"><div><span className="eyebrow">KONFIGURASI</span><h1>Pengaturan</h1><p>Informasi koneksi dan lokasi operasional.</p></div></div><section className="panel settings"><h3>{business?.name}</h3><p>SMART POS JATIBARANG</p><div className="setting-row"><span>Akun aktif</span><b>{session.user.email}</b></div><div className="setting-row"><span>Peran</span><b>{membership?.role}</b></div><div className="setting-row"><span>Cabang</span><b>{branches.find(b=>b.id===branchId)?.name||"—"}</b></div><div className="setting-row"><span>Gudang</span><b>{warehouses.find(w=>w.id===warehouseId)?.name||"—"}</b></div><div className="setting-row"><span>Penyimpanan</span><b className="badge green">Supabase Cloud</b></div><div className="setting-row"><span>Sinkronisasi</span><b className="badge green">Aktif</b></div><p className="warning-note">Transaksi kasir menggunakan prosedur database atomik agar penjualan, pembayaran, kas, dan pengurangan stok tercatat bersama-sama.</p><button className="secondary" onClick={loadData}>↻ Segarkan data</button></section></>}
        <footer>SMART POS JATIBARANG · Data tersimpan di Supabase Cloud</footer>
      </div>
    </main>
  </div>;
}
