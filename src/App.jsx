import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseConfigured } from "./supabase.js";
import JsBarcode from "jsbarcode";

const money = value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);
const BUSINESS_ID = "8552ecbe-a62e-41b9-b274-b855f6b5e37b";
const NAV = [["Dashboard","▦"],["Kasir","▣"],["Produk & Stok","▤"],["Pembelian","⇧"],["Pemasok","♧"],["Pelanggan","♙"],["Garansi","✓"],["Laporan","▥"],["Keuangan","Rp"],["Karyawan & Shift","♙"],["Pengaturan","⚙"]];

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

function CustomerBarcode({customer}) {
  const svgRef = useRef(null);
  const code = customer.customer_code || ("JH" + customer.id.replaceAll("-","").slice(0,12).toUpperCase());
  useEffect(() => {
    if (!svgRef.current || !code) return;
    try { JsBarcode(svgRef.current, code, {format:"CODE128", displayValue:true, font:"Arial", fontSize:13, height:48, margin:5, lineColor:"#10243a", background:"#ffffff"}); }
    catch (error) { console.error("Gagal membuat barcode pelanggan", error); }
  }, [code]);
  function printCard() {
    const barcode = svgRef.current?.outerHTML || "";
    const w = window.open("", "_blank", "width=520,height=420");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Kartu Pelanggan ${code}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#10243a}.card{width:340px;border:2px solid #10243a;border-radius:14px;padding:18px;text-align:center}.brand{font-size:12px;letter-spacing:2px;font-weight:bold}.name{font-size:20px;font-weight:bold;margin:14px 0 4px}.code{font-size:12px;color:#526174;margin-top:4px}svg{max-width:100%;height:auto}</style></head><body><div class="card"><div class="brand">JATIBARANG HELMET · MEMBER</div><div class="name">${String(customer.name).replace(/[&<>"]/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]))}</div>${barcode}<div class="code">${code}</div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }
  return <div className="customer-barcode"><svg ref={svgRef} role="img" aria-label={`Barcode pelanggan ${code}`}/><button type="button" className="text-btn" onClick={printCard}>Cetak kartu</button></div>;
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
  const [membershipTiers,setMembershipTiers] = useState([]);
  const [warranties,setWarranties] = useState([]);
  const [warrantyClaims,setWarrantyClaims] = useState([]);
  const [claimDrafts,setClaimDrafts] = useState({});
  const [branches,setBranches] = useState([]);
  const [warehouses,setWarehouses] = useState([]);
  const [branchId,setBranchId] = useState("");
  const [warehouseId,setWarehouseId] = useState("");
  const [products,setProducts] = useState([]);
  const [customers,setCustomers] = useState([]);
  const [suppliers,setSuppliers] = useState([]);
  const [purchases,setPurchases] = useState([]);
  const [supplierPayments,setSupplierPayments] = useState([]);
  const [paymentDrafts,setPaymentDrafts] = useState({});
  const [sales,setSales] = useState([]);
  const [cashEntries,setCashEntries] = useState([]);
  const [attendanceRows,setAttendanceRows] = useState([]);
  const [cashSessions,setCashSessions] = useState([]);
  const [openingFloat,setOpeningFloat] = useState("0");
  const [countedCash,setCountedCash] = useState("");
  const [shiftNote,setShiftNote] = useState("");
  const [expenseForm,setExpenseForm] = useState({category:"Operasional",description:"",amount:""});
  const [cart,setCart] = useState([]);
  const [search,setSearch] = useState("");
  const [continuousScan,setContinuousScan] = useState(true);
  const [customerScan,setCustomerScan] = useState("");
  const [payment,setPayment] = useState("Tunai");
  const [customerId,setCustomerId] = useState("");
  const [showProductForm,setShowProductForm] = useState(false);
  const [showCustomerForm,setShowCustomerForm] = useState(false);
  const [productForm,setProductForm] = useState({name:"",sku:"",barcode:"",category:"Helm",unit:"pcs",cost_price:"",selling_price:"",discount_type:"none",discount_value:"0",min_stock:"3",initial_quantity:"0",warranty_months:"0",warranty_coverage_percent:"0",warranty_max_amount:"",warranty_min_claim:"0",warranty_max_claims:"1",warranty_terms:""});
  const [customerForm,setCustomerForm] = useState({name:"",phone:"",email:"",address:""});
  const [showSupplierForm,setShowSupplierForm] = useState(false);
  const [supplierForm,setSupplierForm] = useState({name:"",phone:"",email:"",address:""});
  const [purchaseForm,setPurchaseForm] = useState({supplier_id:"",notes:"",product_id:"",quantity:"1",unit_cost:"",supplier_invoice_no:"",due_date:"",initial_payment:"0",payment_method:"Tunai",payment_reference:""});
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
      const [bizRes,branchRes,warehouseRes,productRes,inventoryRes,categoryRes,customerRes,salesRes,suppliersRes,purchasesRes,paymentsRes,cashRes,tiersRes,warrantiesRes,claimsRes,attendanceRes,shiftRes] = await Promise.all([
        supabase.from("businesses").select("id,name,currency,timezone").eq("id",businessId).single(),
        supabase.from("branches").select("id,name,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("warehouses").select("id,name,branch_id,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("products").select("id,business_id,category_id,sku,barcode,name,unit,cost_price,selling_price,min_stock,discount_type,discount_value,warranty_months,warranty_coverage_percent,warranty_max_amount,warranty_min_claim,warranty_max_claims,warranty_terms,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("inventory").select("product_id,warehouse_id,quantity").eq("business_id",businessId),
        supabase.from("categories").select("id,name").eq("business_id",businessId).order("name"),
        supabase.from("customers").select("id,name,customer_code,phone,email,address,total_transactions,total_spend,membership_tier").eq("business_id",businessId).order("name"),
        (branchId ? supabase.from("sales").select("id,invoice_no,status,total,created_at,customer_id,sale_items(quantity)").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("sales").select("id,invoice_no,status,total,created_at,customer_id,sale_items(quantity)").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(100),
        supabase.from("suppliers").select("id,name,phone,email,address").eq("business_id",businessId).order("name"),
        (branchId ? supabase.from("purchase_orders").select("id,purchase_no,status,total,amount_paid,payable_tracking_enabled,due_date,supplier_invoice_no,created_at,supplier_id,suppliers(name),purchase_items(quantity)").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("purchase_orders").select("id,purchase_no,status,total,amount_paid,payable_tracking_enabled,due_date,supplier_invoice_no,created_at,supplier_id,suppliers(name),purchase_items(quantity)").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(100),
        (branchId ? supabase.from("supplier_payments").select("id,purchase_id,supplier_id,amount,payment_method,reference_no,notes,created_at").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("supplier_payments").select("id,purchase_id,supplier_id,amount,payment_method,reference_no,notes,created_at").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(300),
        (branchId ? supabase.from("cash_entries").select("id,entry_type,category,description,amount,created_at,reference_type").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("cash_entries").select("id,entry_type,category,description,amount,created_at,reference_type").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(200),
        supabase.from("membership_tiers").select("id,business_id,tier_code,tier_name,min_transactions,min_spend,discount_percent,is_active").eq("business_id",businessId).order("tier_code"),
        supabase.from("warranties").select("id,business_id,sale_id,sale_item_id,customer_id,product_name,invoice_no,warranty_code,purchase_date,expires_at,quantity,purchase_value,coverage_percent,max_coverage_amount,min_claim_amount,max_claims,claims_used,terms").eq("business_id",businessId).order("created_at",{ascending:false}).limit(500),
        supabase.from("warranty_claims").select("id,business_id,warranty_id,claim_no,claim_description,coverage_value,status,created_at,processed_at,resolution_notes").eq("business_id",businessId).order("created_at",{ascending:false}).limit(500),
        (branchId ? supabase.from("staff_attendance").select("id,business_id,branch_id,user_id,work_date,clock_in_at,clock_out_at,clock_in_note,clock_out_note").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("staff_attendance").select("id,business_id,branch_id,user_id,work_date,clock_in_at,clock_out_at,clock_in_note,clock_out_note").eq("business_id",businessId)).order("work_date",{ascending:false}).limit(100),
        (branchId ? supabase.from("cash_register_sessions").select("id,business_id,branch_id,cashier_id,opened_at,opening_float,closed_at,expected_cash,counted_cash,cash_difference,cash_sales,cash_outflows,opening_note,closing_note,status").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("cash_register_sessions").select("id,business_id,branch_id,cashier_id,opened_at,opening_float,closed_at,expected_cash,counted_cash,cash_difference,cash_sales,cash_outflows,opening_note,closing_note,status").eq("business_id",businessId)).order("opened_at",{ascending:false}).limit(100)
      ]);
      for(const result of [bizRes,branchRes,warehouseRes,productRes,inventoryRes,categoryRes,customerRes,salesRes,suppliersRes,purchasesRes,paymentsRes,cashRes,tiersRes,warrantiesRes,claimsRes,attendanceRes,shiftRes]) if(result.error) throw result.error;
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
      setCustomers(customerRes.data); setSales(salesRes.data); setMembershipTiers(tiersRes.data||[]);
      setSuppliers(suppliersRes.data); setPurchases(purchasesRes.data); setSupplierPayments(paymentsRes.data||[]); setCashEntries(cashRes.data||[]); setWarranties(warrantiesRes.data||[]); setWarrantyClaims(claimsRes.data||[]); setAttendanceRows(attendanceRes.data||[]); setCashSessions(shiftRes.data||[]);
    } catch(e) { setError(e.message||"Gagal memuat data toko."); }
    finally { setBusy(false); }
  },[session,branchId,warehouseId]);

  useEffect(()=>{ if(session) loadData(); },[session,loadData]);

  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(""),3500);return()=>clearTimeout(timer);},[notice]);

  async function saveMembershipTier(tier) {
    if (!business?.id || !["owner","admin"].includes(membership?.role)) return;
    setBusy(true); setError("");
    const payload={id:tier.id,business_id:business.id,tier_code:tier.tier_code,tier_name:tier.tier_name,min_transactions:Math.max(0,Number(tier.min_transactions)||0),min_spend:Math.max(0,Number(tier.min_spend)||0),discount_percent:Math.min(100,Math.max(0,Number(tier.discount_percent)||0)),is_active:Boolean(tier.is_active)};
    const {error:saveError}=await supabase.from("membership_tiers").upsert(payload,{onConflict:"business_id,tier_code"});
    if(saveError)setError(saveError.message);else{setNotice("Aturan membership "+tier.tier_name+" berhasil disimpan.");await loadData();}
    setBusy(false);
  }

  async function recordAttendance(action){
    setBusy(true);setError("");
    const {error:e}=await supabase.rpc("record_staff_attendance",{p_branch_id:branchId,p_action:action,p_note:shiftNote||null});
    setBusy(false);if(e){setError(e.message);return;}
    setShiftNote("");setNotice(action==="clock_in"?"Absen masuk berhasil dicatat.":"Absen pulang berhasil dicatat.");await loadData();
  }
  async function openShift(){
    const amount=Number(openingFloat);
    if(!Number.isFinite(amount)||amount<0){setError("Modal awal kas tidak valid.");return;}
    setBusy(true);setError("");
    const {error:e}=await supabase.rpc("open_cash_register",{p_branch_id:branchId,p_opening_float:amount,p_note:shiftNote||null});
    setBusy(false);if(e){setError(e.message);return;}
    setOpeningFloat("0");setShiftNote("");setNotice("Shift kasir berhasil dibuka.");await loadData();
  }
  async function closeShift(sessionRow){
    const amount=Number(countedCash);
    if(!Number.isFinite(amount)||amount<0){setError("Masukkan jumlah uang fisik yang dihitung.");return;}
    setBusy(true);setError("");
    const {data,error:e}=await supabase.rpc("close_cash_register",{p_session_id:sessionRow.id,p_counted_cash:amount,p_note:shiftNote||null});
    setBusy(false);if(e){setError(e.message);return;}
    const result=data?.[0];setCountedCash("");setShiftNote("");
    setNotice("Shift ditutup. Selisih kas: "+money(result?.cash_difference||0)+".");await loadData();
  }

  async function login(email,password){return await supabase.auth.signInWithPassword({email,password});}
  async function logout(){await supabase.auth.signOut();setBusiness(null);setProducts([]);setCustomers([]);setSales([]);setCart([]);}

  const filteredProducts = useMemo(()=>products.filter(p=>(p.name+" "+(p.sku||"")+" "+p.category).toLowerCase().includes(search.toLowerCase())),[products,search]);
  const cartSubtotal = cart.reduce((sum,item)=>sum+item.price*item.qty,0);
  const cartDiscount = cart.reduce((sum,item)=>sum+(Number(item.discountAmount)||0),0);
  const selectedCustomer = customers.find(c=>c.id===customerId);
  const selectedTier = membershipTiers.find(t=>t.tier_code===(selectedCustomer?.membership_tier||"silver") && t.is_active);
  const membershipDiscount = Math.round(Math.max(0,cartSubtotal-cartDiscount)*(Number(selectedTier?.discount_percent)||0)/100);
  const cartTotal = Math.max(0,cartSubtotal-cartDiscount-membershipDiscount);
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
    const {error:saveError}=await supabase.rpc("create_product_with_stock_discounted",{
      p_business_id:business.id,p_branch_id:branchId,p_warehouse_id:warehouseId,
      p_name:productForm.name,p_sku:productForm.sku,p_barcode:productForm.barcode,
      p_category:productForm.category,p_unit:productForm.unit,
      p_cost_price:Number(productForm.cost_price)||0,p_selling_price:Number(productForm.selling_price)||0,
      p_min_stock:Number(productForm.min_stock)||0,p_initial_quantity:Number(productForm.initial_quantity)||0,
      p_discount_type:productForm.discount_type,p_discount_value:Number(productForm.discount_value)||0,
      p_warranty_months:Number(productForm.warranty_months)||0,p_warranty_coverage_percent:Number(productForm.warranty_coverage_percent)||0,
      p_warranty_max_amount:productForm.warranty_max_amount===""?null:Number(productForm.warranty_max_amount),
      p_warranty_min_claim:Number(productForm.warranty_min_claim)||0,p_warranty_max_claims:Number(productForm.warranty_max_claims)||1,
      p_warranty_terms:productForm.warranty_terms||null
    });
    setBusy(false);
    if(saveError){setError(saveError.message);return;}
    setShowProductForm(false);setProductForm({name:"",sku:"",barcode:"",category:"Helm",unit:"pcs",cost_price:"",selling_price:"",discount_type:"none",discount_value:"0",min_stock:"3",initial_quantity:"0",warranty_months:"0",warranty_coverage_percent:"0",warranty_max_amount:"",warranty_min_claim:"0",warranty_max_claims:"1",warranty_terms:""});
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
      p_notes:purchaseForm.notes||null,p_supplier_invoice_no:purchaseForm.supplier_invoice_no||null,
      p_due_date:purchaseForm.due_date||null,p_initial_payment:Number(purchaseForm.initial_payment)||0,
      p_payment_method:purchaseForm.payment_method,p_payment_reference:purchaseForm.payment_reference||null
    });
    setBusy(false);if(saveError){setError(saveError.message);return;}
    setPurchaseCart([]);setPurchaseForm({supplier_id:"",notes:"",product_id:"",quantity:"1",unit_cost:"",supplier_invoice_no:"",due_date:"",initial_payment:"0",payment_method:"Tunai",payment_reference:""});
    setNotice("Pembelian "+(data?.[0]?.purchase_no||"")+" diterima; stok gudang bertambah.");await loadData();
  }


  async function paySupplierInvoice(purchase){
    const draft=paymentDrafts[purchase.id]||{};
    const amount=Number(draft.amount)||0;
    if(amount<=0){setError("Masukkan nominal pembayaran lebih dari nol.");return;}
    setBusy(true);setError("");
    const {data,error:payError}=await supabase.rpc("record_supplier_payment",{
      p_purchase_id:purchase.id,p_amount:amount,p_payment_method:draft.method||"Tunai",
      p_reference_no:draft.reference||null,p_notes:draft.notes||null
    });
    setBusy(false);
    if(payError){setError(payError.message);return;}
    setNotice("Pembayaran supplier berhasil dicatat. Sisa hutang "+money(data?.[0]?.remaining_balance||0)+".");
    setPaymentDrafts(old=>({...old,[purchase.id]:undefined}));
    await loadData();
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
              <div className="total-line"><span>Subtotal</span><strong>{money(cartSubtotal)}</strong></div><div className="total-line"><span>Diskon produk</span><strong>− {money(cartDiscount)}</strong></div>{membershipDiscount>0&&<div className="total-line"><span>Diskon member {selectedTier?.tier_name||"Member"}</span><strong>− {money(membershipDiscount)}</strong></div>}<div className="total-line"><span>Total bayar</span><strong>{money(cartTotal)}</strong></div><button className="primary full" disabled={!cart.length||busy||!warehouseId} onClick={checkout}>Selesaikan transaksi</button>
            </section></div></>}
        {page==="Produk & Stok"&&<><div className="welcome"><div><span className="eyebrow">INVENTARIS</span><h1>Produk & Stok</h1><p>Katalog dan jumlah stok dari gudang Supabase.</p></div><button className="primary" onClick={()=>setShowProductForm(v=>!v)}>＋ Tambah produk</button></div>
          {showProductForm&&<form className="panel form-grid" onSubmit={saveProduct}><label>Nama produk<input required value={productForm.name} onChange={e=>setProductForm({...productForm,name:e.target.value})}/></label><label>SKU<input value={productForm.sku} onChange={e=>setProductForm({...productForm,sku:e.target.value})}/></label><label>Barcode<input value={productForm.barcode} onChange={e=>setProductForm({...productForm,barcode:e.target.value})}/></label><label>Kategori<input value={productForm.category} onChange={e=>setProductForm({...productForm,category:e.target.value})}/></label><label>Harga modal<input type="number" min="0" required value={productForm.cost_price} onChange={e=>setProductForm({...productForm,cost_price:e.target.value})}/></label><label>Harga jual<input type="number" min="0" required value={productForm.selling_price} onChange={e=>setProductForm({...productForm,selling_price:e.target.value})}/></label><label>Jenis diskon<select value={productForm.discount_type} onChange={e=>setProductForm({...productForm,discount_type:e.target.value})}><option value="none">Tanpa diskon</option><option value="percent">Persentase (%)</option><option value="fixed">Nominal (Rp) per barang</option></select></label><label>Nilai diskon<input type="number" min="0" max={productForm.discount_type==="percent"?100:undefined} value={productForm.discount_value} onChange={e=>setProductForm({...productForm,discount_value:e.target.value})}/></label><label>Stok minimum<input type="number" min="0" value={productForm.min_stock} onChange={e=>setProductForm({...productForm,min_stock:e.target.value})}/></label><label>Stok awal<input type="number" min="0" value={productForm.initial_quantity} onChange={e=>setProductForm({...productForm,initial_quantity:e.target.value})}/></label><div className="form-section-title">Pengaturan garansi (opsional)</div><label>Masa garansi (bulan)<input type="number" min="0" max="120" value={productForm.warranty_months} onChange={e=>setProductForm({...productForm,warranty_months:e.target.value})}/></label><label>Perlindungan (%)<input type="number" min="0" max="100" step="0.5" value={productForm.warranty_coverage_percent} onChange={e=>setProductForm({...productForm,warranty_coverage_percent:e.target.value})}/></label><label>Batas maksimal perlindungan (Rp)<input type="number" min="0" value={productForm.warranty_max_amount} onChange={e=>setProductForm({...productForm,warranty_max_amount:e.target.value})} placeholder="Kosong = tanpa batas"/></label><label>Minimal nilai klaim (Rp)<input type="number" min="0" value={productForm.warranty_min_claim} onChange={e=>setProductForm({...productForm,warranty_min_claim:e.target.value})}/></label><label>Maksimal jumlah klaim<input type="number" min="1" max="20" value={productForm.warranty_max_claims} onChange={e=>setProductForm({...productForm,warranty_max_claims:e.target.value})}/></label><label className="span-2">Ketentuan garansi<textarea rows="2" maxLength="2000" value={productForm.warranty_terms} onChange={e=>setProductForm({...productForm,warranty_terms:e.target.value})} placeholder="Syarat dan pengecualian garansi"/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan produk</button><button type="button" className="secondary" onClick={()=>setShowProductForm(false)}>Batal</button></div></form>}
          <section className="panel"><div className="searchbar"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari produk..."/></div><div className="table-wrap"><table><thead><tr><th>PRODUK</th><th>SKU</th><th>KATEGORI</th><th>HARGA JUAL</th><th>DISKON</th><th>GARANSI</th><th>STOK</th><th>STATUS</th></tr></thead><tbody>{filteredProducts.map(p=><tr key={p.id}><td><b>{p.name}</b></td><td>{p.sku||"—"}</td><td>{p.category}</td><td>{money(p.price)}</td><td>{p.discountType==="percent"?p.discountValue+"%":p.discountType==="fixed"?money(p.discountValue):"—"}</td><td>{Number(p.warranty_months)>0?p.warranty_months+" bln · "+p.warranty_coverage_percent+"%":"—"}</td><td>{p.stock}</td><td><span className={p.stock<=0?"badge red":p.stock<=p.min?"badge yellow":"badge green"}>{p.stock<=0?"Habis":p.stock<=p.min?"Menipis":"Aman"}</span></td></tr>)}</tbody></table></div>{products.length===0&&<div className="empty">Belum ada produk di database.</div>}</section></>}
        {page==="Pemasok"&&<><div className="welcome"><div><span className="eyebrow">MITRA TOKO</span><h1>Pemasok</h1><p>Kelola data pemasok untuk pencatatan pembelian.</p></div><button className="primary" onClick={()=>setShowSupplierForm(v=>!v)}>＋ Tambah pemasok</button></div>
          {showSupplierForm&&<form className="panel form-grid" onSubmit={saveSupplier}><label>Nama pemasok<input required value={supplierForm.name} onChange={e=>setSupplierForm({...supplierForm,name:e.target.value})}/></label><label>Nomor telepon<input value={supplierForm.phone} onChange={e=>setSupplierForm({...supplierForm,phone:e.target.value})}/></label><label>Email<input type="email" value={supplierForm.email} onChange={e=>setSupplierForm({...supplierForm,email:e.target.value})}/></label><label>Alamat<input value={supplierForm.address} onChange={e=>setSupplierForm({...supplierForm,address:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pemasok</button><button type="button" className="secondary" onClick={()=>setShowSupplierForm(false)}>Batal</button></div></form>}
          <section className="panel"><div className="table-wrap"><table><thead><tr><th>NAMA PEMASOK</th><th>TELEPON</th><th>EMAIL</th><th>ALAMAT</th></tr></thead><tbody>{suppliers.map(s=><tr key={s.id}><td><b>{s.name}</b></td><td>{s.phone||"—"}</td><td>{s.email||"—"}</td><td>{s.address||"—"}</td></tr>)}</tbody></table></div>{suppliers.length===0&&<div className="empty">Belum ada data pemasok.</div>}</section></>}
        {page==="Pembelian"&&<><div className="welcome"><div><span className="eyebrow">PENGADAAN STOK</span><h1>Pembelian barang</h1><p>Penerimaan barang menambah stok dan mencatat hutang serta pembayaran supplier.</p></div></div>
          <div className="stats">{card("Sisa hutang (100 pembelian terakhir)",money(purchases.filter(p=>p.payable_tracking_enabled).reduce((s,p)=>s+Math.max(0,Number(p.total)-Number(p.amount_paid||0)),0)),"Tagihan yang tercatat pada daftar terbaru","Rp")}{card("Tagihan jatuh tempo",purchases.filter(p=>p.payable_tracking_enabled&&Number(p.total)>Number(p.amount_paid||0)&&p.due_date&&new Date(p.due_date+"T23:59:59")<new Date()).length,"Perlu segera dibayar","!")}{card("Pembayaran (300 terbaru)",money(supplierPayments.reduce((s,p)=>s+Number(p.amount||0),0)),"Riwayat pembayaran pada cabang aktif","✓")}</div>
          <section className="panel purchase-panel"><h3>Catat penerimaan pembelian</h3><div className="form-grid"><label>Pemasok<select value={purchaseForm.supplier_id} onChange={e=>setPurchaseForm({...purchaseForm,supplier_id:e.target.value})}><option value="">Pilih pemasok (opsional)</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Nomor invoice supplier<input value={purchaseForm.supplier_invoice_no} onChange={e=>setPurchaseForm({...purchaseForm,supplier_invoice_no:e.target.value})} placeholder="Nomor nota supplier"/></label><label>Jatuh tempo<input type="date" min={new Date().toISOString().slice(0,10)} value={purchaseForm.due_date} onChange={e=>setPurchaseForm({...purchaseForm,due_date:e.target.value})}/></label><label>Pembayaran awal (Rp)<input type="number" min="0" value={purchaseForm.initial_payment} onChange={e=>setPurchaseForm({...purchaseForm,initial_payment:e.target.value})}/></label><label>Metode pembayaran<select value={purchaseForm.payment_method} onChange={e=>setPurchaseForm({...purchaseForm,payment_method:e.target.value})}>{["Tunai","Transfer bank","QRIS","Debit"].map(x=><option key={x}>{x}</option>)}</select></label><label>Referensi pembayaran<input value={purchaseForm.payment_reference} onChange={e=>setPurchaseForm({...purchaseForm,payment_reference:e.target.value})} placeholder="Nomor transfer (opsional)"/></label><label>Catatan<input value={purchaseForm.notes} onChange={e=>setPurchaseForm({...purchaseForm,notes:e.target.value})} placeholder="Catatan pembelian"/></label><label>Produk<select value={purchaseForm.product_id} onChange={e=>{const p=products.find(x=>x.id===e.target.value);setPurchaseForm({...purchaseForm,product_id:e.target.value,unit_cost:p?String(p.cost):""});}}><option value="">Pilih produk</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Jumlah<input type="number" min="0.001" step="0.001" value={purchaseForm.quantity} onChange={e=>setPurchaseForm({...purchaseForm,quantity:e.target.value})}/></label><label>Harga modal per unit<input type="number" min="0" value={purchaseForm.unit_cost} onChange={e=>setPurchaseForm({...purchaseForm,unit_cost:e.target.value})}/></label><div className="form-actions"><button type="button" className="secondary" onClick={addPurchaseItem}>＋ Tambahkan barang</button></div></div>
            {purchaseCart.length>0&&<><div className="table-wrap"><table><thead><tr><th>PRODUK</th><th>JUMLAH</th><th>HARGA MODAL</th><th>SUBTOTAL</th><th></th></tr></thead><tbody>{purchaseCart.map(item=><tr key={item.product_id}><td>{item.name}</td><td>{item.quantity}</td><td>{money(item.unit_cost)}</td><td>{money(item.quantity*item.unit_cost)}</td><td><button className="text-btn" onClick={()=>setPurchaseCart(old=>old.filter(x=>x.product_id!==item.product_id))}>Hapus</button></td></tr>)}</tbody></table></div><div className="total-line"><span>Total pembelian</span><strong>{money(purchaseCart.reduce((a,x)=>a+x.quantity*x.unit_cost,0))}</strong></div><button className="primary" disabled={busy} onClick={savePurchase}>Simpan penerimaan dan tambah stok</button></>}
          </section>
          <section className="panel"><div className="panel-head"><div><h3>Riwayat pembelian</h3><p>100 transaksi pembelian terakhir</p></div></div><div className="table-wrap"><table><thead><tr><th>NOMOR / INVOICE</th><th>PEMASOK</th><th>TANGGAL</th><th>JATUH TEMPO</th><th>TOTAL</th><th>DIBAYAR</th><th>SISA HUTANG</th><th>AKSI</th></tr></thead><tbody>{purchases.map(p=>{const tracked=Boolean(p.payable_tracking_enabled);const paid=Number(p.amount_paid)||0;const balance=Math.max(0,Number(p.total)-paid);const overdue=tracked&&balance>0&&p.due_date&&new Date(p.due_date+"T23:59:59")<new Date();const draft=paymentDrafts[p.id];return <React.Fragment key={p.id}><tr><td><b>{p.purchase_no}</b><small>{p.supplier_invoice_no||"Tanpa nomor invoice"}</small></td><td>{p.suppliers?.name||"—"}</td><td>{new Date(p.created_at).toLocaleString("id-ID")}</td><td>{p.due_date?new Date(p.due_date+"T00:00:00").toLocaleDateString("id-ID"):"—"}{overdue&&<small className="danger-text">Terlambat</small>}</td><td>{money(p.total)}</td><td>{money(paid)}</td><td><b className={!tracked?"muted":balance>0?"danger-text":"text-safe"}>{tracked?money(balance):"—"}</b><small>{!tracked?"Riwayat lama":balance<=0?"Lunas":overdue?"Jatuh tempo lewat":"Belum lunas"}</small></td><td>{tracked&&balance>0&&p.supplier_id?<button className="text-btn" onClick={()=>setPaymentDrafts(old=>({...old,[p.id]:old[p.id]?undefined:{amount:String(balance),method:"Tunai",reference:"",notes:""}}))}>Bayar</button>:"—"}</td></tr>{draft&&<tr><td colSpan="8"><div className="payment-inline"><b>Catat pembayaran · {p.purchase_no}</b><div className="form-grid"><label>Nominal pembayaran<input type="number" min="1" max={balance} value={draft.amount} onChange={e=>setPaymentDrafts(old=>({...old,[p.id]:{...draft,amount:e.target.value}}))}/></label><label>Metode<select value={draft.method} onChange={e=>setPaymentDrafts(old=>({...old,[p.id]:{...draft,method:e.target.value}}))}>{["Tunai","Transfer bank","QRIS","Debit"].map(x=><option key={x}>{x}</option>)}</select></label><label>Referensi<input value={draft.reference} onChange={e=>setPaymentDrafts(old=>({...old,[p.id]:{...draft,reference:e.target.value}}))} placeholder="Nomor bukti transfer"/></label><label>Catatan<input value={draft.notes} onChange={e=>setPaymentDrafts(old=>({...old,[p.id]:{...draft,notes:e.target.value}}))} placeholder="Catatan"/></label></div><div className="form-actions"><button className="primary" disabled={busy} onClick={()=>paySupplierInvoice(p)}>Simpan pembayaran</button><button className="secondary" onClick={()=>setPaymentDrafts(old=>({...old,[p.id]:undefined}))}>Batal</button></div></div></td></tr>}</React.Fragment>})}</tbody></table></div>{purchases.length===0&&<div className="empty">Belum ada riwayat pembelian.</div>}</section><section className="panel"><div className="panel-head"><div><h3>Riwayat pembayaran supplier</h3><p>Setiap pembayaran tercatat sebagai pengeluaran kas dengan referensi tagihan.</p></div></div><div className="table-wrap"><table><thead><tr><th>TANGGAL</th><th>PEMBELIAN</th><th>PEMASOK</th><th>METODE</th><th>REFERENSI</th><th>NOMINAL</th></tr></thead><tbody>{supplierPayments.map(pay=>{const po=purchases.find(x=>x.id===pay.purchase_id);return <tr key={pay.id}><td>{new Date(pay.created_at).toLocaleString("id-ID")}</td><td>{po?.purchase_no||"Pembelian"}</td><td>{suppliers.find(s=>s.id===pay.supplier_id)?.name||"—"}</td><td>{pay.payment_method}</td><td>{pay.reference_no||"—"}</td><td><b>{money(pay.amount)}</b></td></tr>})}</tbody></table></div>{supplierPayments.length===0&&<div className="empty">Belum ada pembayaran supplier.</div>}</section></>}

        {page==="Garansi"&&<><div className="welcome"><div><span className="eyebrow">WARRANTY MANAGEMENT</span><h1>Garansi & Klaim</h1><p>Garansi dibuat otomatis dari barang terjual yang memiliki masa garansi aktif.</p></div><button className="secondary" onClick={loadData}>↻ Segarkan</button></div>
          <div className="stats">{card("Garansi tercatat",warranties.length,"Maks. 500 data terbaru","✓")}{card("Masih berlaku",warranties.filter(w=>new Date(w.expires_at)>=new Date()).length,"Berdasarkan tanggal kedaluwarsa","◷")}{card("Klaim menunggu",warrantyClaims.filter(x=>x.status==="submitted").length,"Perlu pemeriksaan Owner","!")}{card("Klaim disetujui",warrantyClaims.filter(x=>x.status==="approved"||x.status==="used").length,"Riwayat perlindungan","▣")}</div>
          <section className="panel"><div className="panel-head"><div><h3>Daftar garansi</h3><p>Garansi terbit otomatis dari penjualan baru.</p></div></div><div className="table-wrap"><table><thead><tr><th>KODE GARANSI</th><th>INVOICE</th><th>PRODUK</th><th>TANGGAL BELI</th><th>BERLAKU S/D</th><th>PERLINDUNGAN</th><th>STATUS</th></tr></thead><tbody>{warranties.map(w=>{const expired=new Date(w.expires_at)<new Date();const customer=customers.find(x=>x.id===w.customer_id);return <tr key={w.id}><td><b>{w.warranty_code}</b><small>{customer?.name||"Tanpa pelanggan"}</small></td><td>{w.invoice_no}</td><td>{w.product_name}<small>Qty {w.quantity}</small></td><td>{new Date(w.purchase_date).toLocaleDateString("id-ID")}</td><td>{new Date(w.expires_at).toLocaleDateString("id-ID")}</td><td>{w.coverage_percent}% · {w.max_coverage_amount?("maks. "+money(w.max_coverage_amount)):"tanpa batas nominal"}</td><td><span className={expired?"badge red":"badge green"}>{expired?"Kedaluwarsa":"Aktif"}</span></td></tr>})}</tbody></table></div>{warranties.length===0&&<div className="empty">Belum ada garansi. Atur masa garansi pada produk, lalu garansi akan dibuat otomatis saat penjualan berikutnya.</div>}</section>
          <section className="panel"><div className="panel-head"><div><h3>Ajukan klaim garansi</h3><p>Pilih garansi yang masih berlaku dan jelaskan alasan klaim.</p></div></div><div className="form-grid">{warranties.filter(w=>new Date(w.expires_at)>=new Date()&&w.claims_used<w.max_claims).map(w=><div className="warranty-claim-card" key={w.id}><b>{w.product_name}</b><small>{w.warranty_code} · {w.invoice_no}</small><textarea rows="2" value={claimDrafts[w.id]||""} onChange={e=>setClaimDrafts(old=>({...old,[w.id]:e.target.value}))} placeholder="Jelaskan kerusakan atau alasan klaim"/><button className="secondary" disabled={busy||!(claimDrafts[w.id]||"").trim()} onClick={async()=>{setBusy(true);setError("");const {data,error:claimError}=await supabase.rpc("submit_warranty_claim",{p_warranty_id:w.id,p_claim_description:claimDrafts[w.id]});setBusy(false);if(claimError)setError(claimError.message);else{setNotice("Klaim berhasil diajukan: "+(data?.[0]?.claim_no||""));setClaimDrafts(old=>({...old,[w.id]:""}));await loadData();}}}>Ajukan klaim</button></div>)}</div>{warranties.filter(w=>new Date(w.expires_at)>=new Date()&&w.claims_used<w.max_claims).length===0&&<div className="empty">Tidak ada garansi aktif yang masih dapat diajukan klaim.</div>}</section>
          <section className="panel"><div className="panel-head"><div><h3>Riwayat klaim</h3><p>Persetujuan klaim hanya dapat dilakukan Owner/Admin.</p></div></div><div className="table-wrap"><table><thead><tr><th>NOMOR KLAIM</th><th>KETERANGAN</th><th>PERLINDUNGAN</th><th>TANGGAL</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>{warrantyClaims.map(claim=>{const w=warranties.find(x=>x.id===claim.warranty_id);return <tr key={claim.id}><td>{claim.claim_no}<small>{w?.warranty_code||"Garansi"}</small></td><td>{claim.claim_description}</td><td>{money(claim.coverage_value)}</td><td>{new Date(claim.created_at).toLocaleDateString("id-ID")}</td><td><span className={"badge "+(claim.status==="approved"?"green":claim.status==="rejected"?"red":"yellow")}>{claim.status.toUpperCase()}</span>{claim.resolution_notes&&<small>{claim.resolution_notes}</small>}</td><td>{claim.status==="submitted"&&["owner","admin"].includes(membership?.role)?<div className="action-group"><button className="text-btn" disabled={busy} onClick={async()=>{setBusy(true);const {error:e}=await supabase.rpc("review_warranty_claim",{p_claim_id:claim.id,p_decision:"approved",p_notes:null});setBusy(false);if(e)setError(e.message);else{setNotice("Klaim disetujui.");await loadData();}}}>Setujui</button><button className="text-btn danger-text" disabled={busy} onClick={async()=>{const note=window.prompt("Alasan penolakan klaim:");if(note===null)return;setBusy(true);const {error:e}=await supabase.rpc("review_warranty_claim",{p_claim_id:claim.id,p_decision:"rejected",p_notes:note});setBusy(false);if(e)setError(e.message);else{setNotice("Klaim ditolak.");await loadData();}}}>Tolak</button></div>:"—"}</td></tr>})}</tbody></table></div>{warrantyClaims.length===0&&<div className="empty">Belum ada klaim garansi.</div>}</section>
        </>}
        {page==="Pelanggan"&&<><div className="welcome"><div><span className="eyebrow">CRM</span><h1>Pelanggan</h1><p>Data pelanggan tersimpan di cloud.</p></div><button className="primary" onClick={()=>setShowCustomerForm(v=>!v)}>＋ Tambah pelanggan</button></div>
          {showCustomerForm&&<form className="panel form-grid" onSubmit={saveCustomer}><label>Nama pelanggan<input required value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/></label><label>Nomor telepon<input value={customerForm.phone} onChange={e=>setCustomerForm({...customerForm,phone:e.target.value})}/></label><label>Email<input type="email" value={customerForm.email} onChange={e=>setCustomerForm({...customerForm,email:e.target.value})}/></label><label>Alamat<input value={customerForm.address} onChange={e=>setCustomerForm({...customerForm,address:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pelanggan</button></div></form>}
          <section className="panel"><div className="table-wrap"><table><thead><tr><th>ID BARCODE</th><th>NAMA</th><th>MEMBER</th><th>TOTAL BELANJA</th><th>TRANSAKSI</th><th>TELEPON</th></tr></thead><tbody>{customers.map(c=><tr key={c.id}><td><CustomerBarcode customer={c}/></td><td><b>{c.name}</b></td><td><span className={"badge "+(c.membership_tier==="platinum"?"purple":c.membership_tier==="gold"?"yellow":"green")}>{(c.membership_tier||"silver").toUpperCase()}</span></td><td>{money(c.total_spend)}</td><td>{c.total_transactions||0}</td><td>{c.phone||"—"}</td></tr>)}</tbody></table></div>{customers.length===0&&<div className="empty">Belum ada data pelanggan.</div>}</section></>}
        {page==="Laporan"&&<><div className="welcome"><div><span className="eyebrow">ANALITIK</span><h1>Laporan Penjualan</h1><p>Transaksi yang tercatat pada database.</p></div><button className="secondary" onClick={()=>{const rows=[["Invoice","Status","Tanggal","Total"],...sales.map(s=>[s.invoice_no,s.status,s.created_at,s.total])];const csv=rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.download="laporan-smart-pos.csv";a.click();URL.revokeObjectURL(a.href);}}>↓ Ekspor CSV</button></div>
          <div className="stats">{card("Total transaksi",sales.length,"Data cloud","▣")}{card("Total penjualan",money(sales.reduce((a,s)=>a+Number(s.total),0)),"Semua waktu","↗")}{card("Penjualan hari ini",money(revenue),todayKey,"▦")}{card("Rata-rata transaksi",money(sales.length?sales.reduce((a,s)=>a+Number(s.total),0)/sales.length:0),"Per transaksi","◷")}</div>
          <section className="panel"><div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>TANGGAL</th><th>STATUS</th><th>JUMLAH ITEM</th><th>TOTAL</th></tr></thead><tbody>{sales.map(s=><tr key={s.id}><td>{s.invoice_no}</td><td>{new Date(s.created_at).toLocaleString("id-ID")}</td><td>{s.status}</td><td>{(s.sale_items||[]).reduce((n,item)=>n+Number(item.quantity),0)}</td><td className="amount">{money(s.total)}</td></tr>)}</tbody></table></div>{sales.length===0&&<div className="empty">Belum ada transaksi.</div>}</section></>}
        {page==="Keuangan"&&<><div className="welcome"><div><span className="eyebrow">FINANCIAL MANAGEMENT</span><h1>Keuangan</h1><p>Ringkasan uang masuk dan pengeluaran yang tercatat di database untuk cabang aktif.</p></div></div>
          <div className="stats">{card("Uang masuk",money(cashEntries.filter(x=>x.entry_type==="income").reduce((a,x)=>a+Number(x.amount),0)),"Maks. 200 catatan terbaru","↗")}{card("Pengeluaran",money(cashEntries.filter(x=>x.entry_type==="expense").reduce((a,x)=>a+Number(x.amount),0)),"Maks. 200 catatan terbaru","↘")}{card("Arus kas bersih",money(cashEntries.reduce((a,x)=>a+(x.entry_type==="income"?1:-1)*Number(x.amount),0)),"Masuk dikurangi keluar","⇄")}{card("Catatan kas",cashEntries.length+" transaksi","Cabang aktif","▤")}</div>
          {["owner","admin","manager"].includes(membership?.role)&&<form className="panel form-grid" onSubmit={saveExpense}><div><h3>Catat pengeluaran</h3><p className="muted">Hanya Owner, Admin, dan Manager yang dapat menyimpan pengeluaran.</p></div><label>Kategori<select value={expenseForm.category} onChange={e=>setExpenseForm({...expenseForm,category:e.target.value})}><option>Operasional</option><option>Transportasi</option><option>Listrik & Air</option><option>Gaji</option><option>Pemasaran</option><option>Perawatan</option><option>Lainnya</option></select></label><label>Keterangan<input required maxLength="500" value={expenseForm.description} onChange={e=>setExpenseForm({...expenseForm,description:e.target.value})} placeholder="Contoh: pembelian perlengkapan toko"/></label><label>Nominal (Rp)<input required type="number" min="1" step="1" value={expenseForm.amount} onChange={e=>setExpenseForm({...expenseForm,amount:e.target.value})} placeholder="100000"/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pengeluaran</button></div></form>}
          <section className="panel"><div className="panel-head"><div><h3>Riwayat kas</h3><p>Uang masuk dari transaksi dan pengeluaran manual</p></div><button className="secondary" onClick={loadData}>↻ Segarkan</button></div><div className="table-wrap"><table><thead><tr><th>TANGGAL</th><th>JENIS</th><th>KATEGORI</th><th>KETERANGAN</th><th>NOMINAL</th></tr></thead><tbody>{cashEntries.map(x=><tr key={x.id}><td>{new Date(x.created_at).toLocaleString("id-ID")}</td><td><span className={x.entry_type==="income"?"badge green":"badge red"}>{x.entry_type==="income"?"Masuk":"Keluar"}</span></td><td>{x.category}</td><td>{x.description}</td><td className="amount">{money(x.amount)}</td></tr>)}</tbody></table></div>{cashEntries.length===0&&<div className="empty">Belum ada catatan kas untuk cabang ini.</div>}</section>
          <p className="warning-note">Catatan: ringkasan ini memakai maksimal 200 catatan terbaru. Pembelian barang yang diterima belum otomatis menjadi pengeluaran kas karena pembayaran pemasok/hutang belum dibangun. Laba-rugi akuntansi belum ditampilkan pada tahap ini.</p></>}
        {page==="Karyawan & Shift"&&<><div className="welcome"><div><span className="eyebrow">PEOPLE & CASH CONTROL</span><h1>Karyawan, Absensi & Shift</h1><p>Catat jam kerja dan cocokkan uang fisik dengan transaksi tunai per kasir.</p></div><button className="secondary" onClick={loadData}>↻ Segarkan</button></div>
          <div className="stats">{card("Absensi hari ini",attendanceRows.filter(a=>a.work_date===new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"})).length,"Catatan pada cabang aktif","◷")}{card("Shift terbuka",cashSessions.filter(s=>s.status==="open").length,"Kasir yang belum tutup shift","▣")}{card("Shift ditutup",cashSessions.filter(s=>s.status==="closed").length,"Riwayat 100 shift terbaru","✓")}{card("Selisih kas tercatat",money(cashSessions.filter(s=>s.status==="closed").reduce((sum,s)=>sum+Number(s.cash_difference||0),0)),"Akumulasi pada daftar terbaru","Rp")}</div>
          <section className="panel"><div className="panel-head"><div><h3>Absensi saya</h3><p>Jam masuk dan pulang tercatat berdasarkan akun login.</p></div></div>
            {(()=>{const today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"});const mine=attendanceRows.find(a=>a.user_id===session.user.id&&a.work_date===today);return <><div className="setting-row"><span>Status hari ini</span><b className={mine?.clock_out_at?"badge green":mine?"badge yellow":"badge"}>{mine?.clock_out_at?"Sudah pulang":mine?"Sedang bekerja":"Belum absen"}</b></div><div className="setting-row"><span>Jam masuk</span><b>{mine?.clock_in_at?new Date(mine.clock_in_at).toLocaleString("id-ID"):"—"}</b></div><div className="setting-row"><span>Jam pulang</span><b>{mine?.clock_out_at?new Date(mine.clock_out_at).toLocaleString("id-ID"):"—"}</b></div><label>Catatan (opsional)<input value={shiftNote} maxLength="500" onChange={e=>setShiftNote(e.target.value)} placeholder="Contoh: mulai shift pagi"/></label><div className="form-actions"><button className="primary" disabled={busy||Boolean(mine)} onClick={()=>recordAttendance("clock_in")}>Absen masuk</button><button className="secondary" disabled={busy||!mine||Boolean(mine.clock_out_at)} onClick={()=>recordAttendance("clock_out")}>Absen pulang</button></div></>;})()}
          </section>
          <section className="panel"><div className="panel-head"><div><h3>Shift kasir saya</h3><p>Modal awal + penjualan tunai − pengeluaran kas yang dicatat oleh kasir.</p></div></div>
            {(()=>{const opened=cashSessions.find(s=>s.cashier_id===session.user.id&&s.status==="open");return opened?<><div className="setting-row"><span>Shift dibuka</span><b>{new Date(opened.opened_at).toLocaleString("id-ID")}</b></div><div className="setting-row"><span>Modal awal</span><b>{money(opened.opening_float)}</b></div><label>Uang fisik saat tutup (Rp)<input type="number" min="0" step="1" value={countedCash} onChange={e=>setCountedCash(e.target.value)} placeholder="Hitung seluruh uang tunai di laci"/></label><label>Catatan tutup shift<input value={shiftNote} maxLength="500" onChange={e=>setShiftNote(e.target.value)} placeholder="Catatan selisih atau kondisi kas"/></label><button className="primary" disabled={busy||countedCash===""} onClick={()=>closeShift(opened)}>Tutup shift & hitung selisih</button></>:<><label>Modal awal kas (Rp)<input type="number" min="0" step="1" value={openingFloat} onChange={e=>setOpeningFloat(e.target.value)}/></label><label>Catatan buka shift<input value={shiftNote} maxLength="500" onChange={e=>setShiftNote(e.target.value)} placeholder="Contoh: laci kasir A"/></label><button className="primary" disabled={busy||!branchId} onClick={openShift}>Buka shift kasir</button></>;})()}
          </section>
          <section className="panel"><div className="panel-head"><div><h3>Riwayat absensi cabang</h3><p>Data 100 catatan terbaru. Identitas ditampilkan dengan ID akun untuk sementara.</p></div></div><div className="table-wrap"><table><thead><tr><th>TANGGAL</th><th>ID AKUN</th><th>MASUK</th><th>PULANG</th><th>DURASI</th></tr></thead><tbody>{attendanceRows.map(a=><tr key={a.id}><td>{new Date(a.work_date+"T00:00:00").toLocaleDateString("id-ID")}</td><td>{a.user_id===session.user.id?"Akun saya":a.user_id.slice(0,8)+"…"}</td><td>{new Date(a.clock_in_at).toLocaleTimeString("id-ID")}</td><td>{a.clock_out_at?new Date(a.clock_out_at).toLocaleTimeString("id-ID"):"—"}</td><td>{a.clock_out_at?Math.max(0,Math.round((new Date(a.clock_out_at)-new Date(a.clock_in_at))/60000))+" menit":"Aktif"}</td></tr>)}</tbody></table></div>{attendanceRows.length===0&&<div className="empty">Belum ada catatan absensi.</div>}</section>
          <section className="panel"><div className="panel-head"><div><h3>Riwayat shift kasir</h3><p>Rekonsiliasi uang tunai per kasir dan cabang.</p></div></div><div className="table-wrap"><table><thead><tr><th>DIBUKA</th><th>KASIR</th><th>MODAL AWAL</th><th>PENJUALAN TUNAI</th><th>PENGELUARAN</th><th>UANG SEHARUSNYA</th><th>UANG FISIK</th><th>SELISIH</th><th>STATUS</th></tr></thead><tbody>{cashSessions.map(s=><tr key={s.id}><td>{new Date(s.opened_at).toLocaleString("id-ID")}</td><td>{s.cashier_id===session.user.id?"Akun saya":s.cashier_id.slice(0,8)+"…"}</td><td>{money(s.opening_float)}</td><td>{s.status==="closed"?money(s.cash_sales):"Berjalan"}</td><td>{s.status==="closed"?money(s.cash_outflows):"—"}</td><td>{s.status==="closed"?money(s.expected_cash):"—"}</td><td>{s.status==="closed"?money(s.counted_cash):"—"}</td><td>{s.status==="closed"?<b className={Number(s.cash_difference)===0?"text-safe":"danger-text"}>{money(s.cash_difference)}</b>:"—"}</td><td><span className={"badge "+(s.status==="closed"?"green":"yellow")}>{s.status==="closed"?"Ditutup":"Terbuka"}</span></td></tr>)}</tbody></table></div>{cashSessions.length===0&&<div className="empty">Belum ada shift kasir.</div>}</section>
        </>}
        {page==="Pengaturan"&&<><div className="welcome"><div><span className="eyebrow">KONFIGURASI</span><h1>Pengaturan</h1><p>Informasi koneksi dan lokasi operasional.</p></div></div><section className="panel settings"><h3>{business?.name}</h3><p>SMART POS JATIBARANG</p><div className="setting-row"><span>Akun aktif</span><b>{session.user.email}</b></div><div className="setting-row"><span>Peran</span><b>{membership?.role}</b></div><div className="setting-row"><span>Cabang</span><b>{branches.find(b=>b.id===branchId)?.name||"—"}</b></div><div className="setting-row"><span>Gudang</span><b>{warehouses.find(w=>w.id===warehouseId)?.name||"—"}</b></div><div className="setting-row"><span>Penyimpanan</span><b className="badge green">Supabase Cloud</b></div><div className="setting-row"><span>Sinkronisasi</span><b className="badge green">Aktif</b></div><p className="warning-note">Transaksi kasir menggunakan prosedur database atomik agar penjualan, pembayaran, kas, dan pengurangan stok tercatat bersama-sama.</p><button className="secondary" onClick={loadData}>↻ Segarkan data</button></section>
          <section className="panel"><div className="panel-head"><div><h3>Aturan membership</h3><p>Atur syarat kenaikan Silver, Gold, dan Platinum. Tingkat aktif dihitung otomatis dari transaksi lunas pelanggan.</p></div></div>
          {membershipTiers.map(t=><form key={t.tier_code} className="form-grid tier-form" onSubmit={e=>{e.preventDefault();saveMembershipTier(t);}}>
            <label>Nama tingkat<input value={t.tier_name} onChange={e=>setMembershipTiers(rows=>rows.map(x=>x.id===t.id?{...x,tier_name:e.target.value}:x))}/></label>
            <label>Minimal transaksi<input type="number" min="0" step="1" value={t.min_transactions} onChange={e=>setMembershipTiers(rows=>rows.map(x=>x.id===t.id?{...x,min_transactions:e.target.value}:x))}/></label>
            <label>Minimal akumulasi belanja (Rp)<input type="number" min="0" step="1000" value={t.min_spend} onChange={e=>setMembershipTiers(rows=>rows.map(x=>x.id===t.id?{...x,min_spend:e.target.value}:x))}/></label>
            <label>Diskon member (%)<input type="number" min="0" max="100" step="0.5" value={t.discount_percent} onChange={e=>setMembershipTiers(rows=>rows.map(x=>x.id===t.id?{...x,discount_percent:e.target.value}:x))}/></label>
            <label className="check-label"><input type="checkbox" checked={t.is_active} onChange={e=>setMembershipTiers(rows=>rows.map(x=>x.id===t.id?{...x,is_active:e.target.checked}:x))}/> Aktifkan tingkat</label>
            <div className="form-actions"><button className="primary" disabled={busy||!["owner","admin"].includes(membership?.role)}>Simpan {t.tier_name}</button></div>
          </form>)}
          {!["owner","admin"].includes(membership?.role)&&<p className="warning-note">Hanya Owner/Admin yang dapat mengubah aturan membership.</p>}
          </section></>}
        <footer>SMART POS JATIBARANG · Data tersimpan di Supabase Cloud</footer>
      </div>
    </main>
  </div>;
}
