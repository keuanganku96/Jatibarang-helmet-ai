import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseConfigured } from "./supabase.js";
import JsBarcode from "jsbarcode";

const money = value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);
const BUSINESS_ID = "8552ecbe-a62e-41b9-b274-b855f6b5e37b";
const NAV = [["Dashboard","▦"],["Kasir","▣"],["Piutang Pelanggan","Rp"],["Retur Penjualan","↩"],["Produk & Stok","▤"],["Stok Opname","▧"],["Transfer Stok","⇄"],["Pembelian","⇧"],["Retur Pembelian","↩"],["Pemasok","♧"],["Pelanggan","♙"],["Loyalty Point","★"],["Garansi","✓"],["Laporan","▥"],["Keuangan","Rp"],["Karyawan & Shift","♙"],["Pengaturan","⚙"]];

function getStaffDeviceId(){let id=localStorage.getItem("smartpos_device_id");if(!id){id=crypto.randomUUID();localStorage.setItem("smartpos_device_id",id);}return id;}
function Login({onLogin}){
 const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [staffBusy,setStaffBusy]=useState(false),[staffError,setStaffError]=useState(""),[staffList,setStaffList]=useState([]),[staffCode,setStaffCode]=useState(""),[pin,setPin]=useState("");
 const businessId=localStorage.getItem("smartpos_business_id")||"",deviceId=getStaffDeviceId();
 useEffect(()=>{let alive=true;if(!businessId)return;supabase.functions.invoke("staff-access",{body:{action:"list_staff",business_id:businessId,device_id:deviceId}}).then(({data,error})=>{if(!alive)return;if(error||data?.error){setStaffError(data?.error||"Perangkat belum dipasangkan Owner.");return;}setStaffList(data?.staff||[]);if(data?.staff?.length)setStaffCode(data.staff[0].employee_code);});return()=>{alive=false;};},[businessId,deviceId]);
 async function submit(e){e.preventDefault();setBusy(true);setError("");const {error}=await onLogin(email.trim(),password);if(error)setError(error.message||"Tidak dapat masuk. Periksa email dan kata sandi.");setBusy(false);}
 async function submitStaff(e){e.preventDefault();setStaffBusy(true);setStaffError("");const {data,error}=await supabase.functions.invoke("staff-access",{body:{action:"staff_login",business_id:businessId,device_id:deviceId,employee_code:staffCode,pin}});if(error||data?.error){setStaffError(data?.error||error?.message||"Login PIN gagal.");setStaffBusy(false);return;}const {error:verifyError}=await supabase.auth.verifyOtp({token_hash:data.token_hash,type:"magiclink"});if(verifyError)setStaffError(verifyError.message||"Tidak dapat membuat sesi karyawan.");setPin("");setStaffBusy(false);}
 return <main className="auth-screen">
  <form className="auth-card" onSubmit={submit}><div className="brand-mark auth-mark">SJ</div><span className="eyebrow">JATIBARANG HELMET</span><h1>SMART POS</h1><p>Masuk sebagai Owner menggunakan akun yang terdaftar.</p><label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email akun Owner"/></label><label>Kata sandi<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Kata sandi"/></label>{error&&<div className="notice error-notice">{error}</div>}<button className="primary full" disabled={busy}>{busy?"Memeriksa...":"Masuk sebagai Owner"}</button></form>
  <form className="auth-card" onSubmit={submitStaff}><span className="eyebrow">AKSES KARYAWAN</span><h2>Masuk dengan PIN</h2><p>Pilih nama dan masukkan PIN 6 angka. Perangkat harus disetujui Owner.</p><label>Nama karyawan<select required value={staffCode} onChange={e=>setStaffCode(e.target.value)} disabled={!staffList.length}><option value="">{staffList.length?"Pilih karyawan":"Perangkat belum dipasangkan"}</option>{staffList.map(x=><option key={x.id} value={x.employee_code}>{x.full_name} · {x.employee_code}</option>)}</select></label><label>PIN<input type="password" inputMode="numeric" autoComplete="one-time-code" maxLength="6" pattern="[0-9]{6}" required value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="6 angka"/></label>{staffError&&<div className="notice error-notice">{staffError}</div>}<button className="primary full" disabled={staffBusy||!businessId||!staffList.length||pin.length!==6}>{staffBusy?"Memverifikasi PIN...":"Masuk sebagai karyawan"}</button><small>{businessId?"Jika perangkat belum disetujui, minta Owner memasangkannya di menu Karyawan & Shift.":"Masuk sebagai Owner sekali pada perangkat ini untuk menghubungkan toko."}</small></form>
 </main>;
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
  const [loyaltyProgram,setLoyaltyProgram] = useState(null);
  const [loyaltyLedger,setLoyaltyLedger] = useState([]);
  const [loyaltyDraft,setLoyaltyDraft] = useState({is_enabled:false,earn_amount_per_point:"",redemption_value_per_point:"",minimum_redeem_points:"1"});
  const [loyaltyRedeemDraft,setLoyaltyRedeemDraft] = useState({customer_id:"",points:"",description:"Hadiah penukaran poin"});
  const [warranties,setWarranties] = useState([]);
  const [warrantyClaims,setWarrantyClaims] = useState([]);
  const [claimDrafts,setClaimDrafts] = useState({});
  const [branches,setBranches] = useState([]);
  const [warehouses,setWarehouses] = useState([]);
  const [branchId,setBranchId] = useState("");
  const [warehouseId,setWarehouseId] = useState("");
  const [products,setProducts] = useState([]);
  const [inventoryRows,setInventoryRows] = useState([]);
  const [customers,setCustomers] = useState([]);
  const [suppliers,setSuppliers] = useState([]);
  const [purchases,setPurchases] = useState([]);
  const [supplierReturns,setSupplierReturns] = useState([]);
  const [supplierReturnDraft,setSupplierReturnDraft] = useState({purchase_id:"",reason:"",notes:""});
  const [supplierReturnQuantities,setSupplierReturnQuantities] = useState({});
  const [supplierPayments,setSupplierPayments] = useState([]);
  const [paymentDrafts,setPaymentDrafts] = useState({});
  const [sales,setSales] = useState([]);
  const [saleReturns,setSaleReturns] = useState([]);
  const [returnSearch,setReturnSearch] = useState("");
  const [selectedReturnSaleId,setSelectedReturnSaleId] = useState("");
  const [returnQtyDraft,setReturnQtyDraft] = useState({});
  const [returnReason,setReturnReason] = useState("");
  const [returnMethod,setReturnMethod] = useState("Tunai");
  const [returnRestock,setReturnRestock] = useState(true);
  const [reportPeriod,setReportPeriod] = useState("30");
  const [reportSearch,setReportSearch] = useState("");
  const [reportStaffFilter,setReportStaffFilter] = useState("all");
  const [reportPaymentFilter,setReportPaymentFilter] = useState("all");
  const [reportCategoryFilter,setReportCategoryFilter] = useState("all");
  const [reportStartDate,setReportStartDate] = useState("");
  const [reportEndDate,setReportEndDate] = useState("");
  const [profitLoss,setProfitLoss] = useState(null);
  const [profitLossLoading,setProfitLossLoading] = useState(false);
  const [cashEntries,setCashEntries] = useState([]);
  const [attendanceRows,setAttendanceRows] = useState([]);
  const [cashSessions,setCashSessions] = useState([]);
  const [staffMembers,setStaffMembers] = useState([]);
  const [commissionLedger,setCommissionLedger] = useState([]);
  const [commissionRules,setCommissionRules] = useState([]);
  const [commissionRuleDraft,setCommissionRuleDraft] = useState({branch_id:"",product_id:"",commission_type:"percent",commission_value:"0"});
  const [staffDraft,setStaffDraft] = useState({employee_code:"",full_name:"",phone:"",job_title:"",branch_id:"",role:"cashier",commission_type:"percent",commission_value:"0",pin:""});
  const [stockOpnames,setStockOpnames] = useState([]);
  const [stockCountDraft,setStockCountDraft] = useState({});
  const [opnameNotes,setOpnameNotes] = useState("");
  const [stockTransfers,setStockTransfers] = useState([]);
  const [transferDestination,setTransferDestination] = useState("");
  const [transferProduct,setTransferProduct] = useState("");
  const [transferQuantity,setTransferQuantity] = useState("1");
  const [transferNotes,setTransferNotes] = useState("");
  const [openingFloat,setOpeningFloat] = useState("0");
  const [countedCash,setCountedCash] = useState("");
  const [shiftNote,setShiftNote] = useState("");
  const [expenseForm,setExpenseForm] = useState({category:"Operasional",description:"",amount:""});
  const [cart,setCart] = useState([]);
  const [receiptData,setReceiptData] = useState(null);
  const [receiptWidth,setReceiptWidth] = useState(()=>localStorage.getItem("smartpos_receipt_width")==="80"?"80":"58");
  const [printerName,setPrinterName] = useState(()=>localStorage.getItem("smartpos_printer_name")||"");
  const [autoPrintReceipt,setAutoPrintReceipt] = useState(()=>localStorage.getItem("smartpos_auto_print_receipt")==="true");
  const [autoOpenCashDrawer,setAutoOpenCashDrawer] = useState(()=>localStorage.getItem("smartpos_auto_open_cash_drawer")==="true");
  const usbPrinterDeviceRef = useRef(null);
  useEffect(()=>{localStorage.setItem("smartpos_auto_open_cash_drawer",String(autoOpenCashDrawer));},[autoOpenCashDrawer]);
  useEffect(()=>{localStorage.setItem("smartpos_auto_print_receipt",String(autoPrintReceipt));},[autoPrintReceipt]);
  const [printerConnection,setPrinterConnection] = useState({type:"none",status:"disconnected",name:""});
  const [printerBusy,setPrinterBusy] = useState(false);
  const [printerCapabilities,setPrinterCapabilities] = useState({bluetooth:typeof navigator!=="undefined"&&!!navigator.bluetooth,usb:typeof navigator!=="undefined"&&!!navigator.usb});
  useEffect(()=>{localStorage.setItem("smartpos_receipt_width",receiptWidth);},[receiptWidth]);
  useEffect(()=>{localStorage.setItem("smartpos_printer_name",printerName);},[printerName]);
  useEffect(()=>{let active=true;async function restore(){try{if(navigator.usb?.getDevices){const ds=await navigator.usb.getDevices();if(active&&ds.length){const d=ds[0];usbPrinterDeviceRef.current=d;setPrinterConnection({type:"usb",status:"permission",name:d.productName||d.manufacturerName||"Printer USB"});setPrinterName(d.productName||d.manufacturerName||printerName);}}}catch(e){console.info("USB printer permission not restored",e);}}restore();return()=>{active=false;};},[]);
  const [search,setSearch] = useState("");
  const [continuousScan,setContinuousScan] = useState(true);
  const [customerScan,setCustomerScan] = useState("");
  const [payment,setPayment] = useState("Tunai");
  const [paymentLines,setPaymentLines] = useState([{payment_method:"Tunai",amount:"",payment_reference:""}]);
  const [paymentDueDate,setPaymentDueDate] = useState("");
  const [fullCredit,setFullCredit] = useState(false);
  const [paymentNotes,setPaymentNotes] = useState("");
  const [selectedReceivableId,setSelectedReceivableId] = useState("");
  const [receivablePaymentDraft,setReceivablePaymentDraft] = useState({payment_method:"Tunai",amount:"",payment_reference:""});
  const [customerId,setCustomerId] = useState("");
  const [showProductForm,setShowProductForm] = useState(false);
  const [showVariantForm,setShowVariantForm] = useState(false);
  const [variantForm,setVariantForm] = useState({parent_product_id:"",variant_label:"",sku:"",barcode:"",cost_price:"",selling_price:"",min_stock:"3",initial_quantity:"0"});
  const [editingProductId,setEditingProductId] = useState("");
  const [productImageFile,setProductImageFile] = useState(null);
  const [productImagePreview,setProductImagePreview] = useState("");
  const [productViewMode,setProductViewMode] = useState("list");
  const [productStockFilter,setProductStockFilter] = useState("all");
  const [selectedLabelProducts,setSelectedLabelProducts] = useState([]);
  const [labelCopies,setLabelCopies] = useState({});
  const [labelSize,setLabelSize] = useState("50x30");
  const [labelGap,setLabelGap] = useState("2");
  const [showCustomerForm,setShowCustomerForm] = useState(false);
  const [productForm,setProductForm] = useState({name:"",sku:"",barcode:"",category:"Helm",unit:"pcs",cost_price:"",selling_price:"",discount_type:"none",discount_value:"0",commission_type:"inherit",commission_value:"0",min_stock:"3",initial_quantity:"0",warranty_months:"0",warranty_coverage_percent:"0",warranty_max_amount:"",warranty_min_claim:"0",warranty_max_claims:"1",warranty_terms:"",image_url:""});
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
      localStorage.setItem("smartpos_business_id", businessId);
      const [bizRes,branchRes,warehouseRes,productRes,inventoryRes,categoryRes,customerRes,salesRes,suppliersRes,purchasesRes,paymentsRes,cashRes,tiersRes,warrantiesRes,claimsRes,attendanceRes,shiftRes,opnameRes,transferRes,returnsRes,loyaltyProgramRes,loyaltyLedgerRes,supplierReturnsRes] = await Promise.all([
        supabase.from("businesses").select("id,name,currency,timezone").eq("id",businessId).single(),
        supabase.from("branches").select("id,name,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("warehouses").select("id,name,branch_id,is_active").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("products").select("id,business_id,category_id,sku,barcode,name,unit,cost_price,selling_price,min_stock,image_url,discount_type,discount_value,warranty_months,warranty_coverage_percent,warranty_max_amount,warranty_min_claim,warranty_max_claims,warranty_terms,is_active,variant_parent_id,variant_label").eq("business_id",businessId).eq("is_active",true).order("name"),
        supabase.from("inventory").select("product_id,warehouse_id,quantity").eq("business_id",businessId),
        supabase.from("categories").select("id,name").eq("business_id",businessId).order("name"),
        supabase.from("customers").select("id,name,customer_code,phone,email,address,total_transactions,total_spend,membership_tier,created_at").eq("business_id",businessId).order("name"),
        (branchId ? supabase.from("sales").select("id,invoice_no,status,total,due_date,receivable_notes,created_at,customer_id,cashier_id,sale_items(id,product_id,product_name,quantity,unit_price,unit_cost,discount,line_total),sale_payments(id,payment_method,amount,payment_reference,payment_status,created_at)").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("sales").select("id,invoice_no,status,total,due_date,receivable_notes,created_at,customer_id,cashier_id,sale_items(id,product_id,product_name,quantity,unit_price,unit_cost,discount,line_total),sale_payments(id,payment_method,amount,payment_reference,payment_status,created_at)").eq("business_id",businessId )).order("created_at",{ascending:false}).limit(1000),
        supabase.from("suppliers").select("id,name,phone,email,address").eq("business_id",businessId).order("name"),
        (branchId ? supabase.from("purchase_orders").select("id,purchase_no,status,total,amount_paid,payable_tracking_enabled,due_date,supplier_invoice_no,created_at,supplier_id,suppliers(name),purchase_items(id,product_id,quantity,unit_cost,line_total)").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("purchase_orders").select("id,purchase_no,status,total,amount_paid,payable_tracking_enabled,due_date,supplier_invoice_no,created_at,supplier_id,suppliers(name),purchase_items(id,product_id,quantity,unit_cost,line_total)").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(100),
        (branchId ? supabase.from("supplier_payments").select("id,purchase_id,supplier_id,amount,payment_method,reference_no,notes,created_at").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("supplier_payments").select("id,purchase_id,supplier_id,amount,payment_method,reference_no,notes,created_at").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(300),
        (branchId ? supabase.from("cash_entries").select("id,entry_type,category,description,amount,created_at,reference_type").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("cash_entries").select("id,entry_type,category,description,amount,created_at,reference_type").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(200),
        supabase.from("membership_tiers").select("id,business_id,tier_code,tier_name,min_transactions,min_spend,discount_percent,is_active").eq("business_id",businessId).order("tier_code"),
        supabase.from("loyalty_programs").select("id,business_id,is_enabled,earn_amount_per_point,redemption_value_per_point,minimum_redeem_points,updated_at").eq("business_id",businessId).maybeSingle(),
        supabase.from("loyalty_point_ledger").select("id,customer_id,branch_id,event_type,points_delta,reference_type,reference_id,description,created_at").eq("business_id",businessId).order("created_at",{ascending:false}).limit(1000),
        (branchId ? supabase.from("supplier_returns").select("id,business_id,branch_id,purchase_id,supplier_id,return_no,status,reason,notes,total,created_at,approved_at,suppliers(name),purchase_orders(purchase_no),supplier_return_items(id,product_id,quantity,unit_cost,line_total)").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("supplier_returns").select("id,business_id,branch_id,purchase_id,supplier_id,return_no,status,reason,notes,total,created_at,approved_at,suppliers(name),purchase_orders(purchase_no),supplier_return_items(id,product_id,quantity,unit_cost,line_total)").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(300),
        supabase.from("warranties").select("id,business_id,sale_id,sale_item_id,customer_id,product_name,invoice_no,warranty_code,purchase_date,expires_at,quantity,purchase_value,coverage_percent,max_coverage_amount,min_claim_amount,max_claims,claims_used,terms").eq("business_id",businessId).order("created_at",{ascending:false}).limit(500),
        supabase.from("warranty_claims").select("id,business_id,warranty_id,claim_no,claim_description,coverage_value,status,created_at,processed_at,resolution_notes").eq("business_id",businessId).order("created_at",{ascending:false}).limit(500),
        (branchId ? supabase.from("staff_attendance").select("id,business_id,branch_id,user_id,work_date,clock_in_at,clock_out_at,clock_in_note,clock_out_note").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("staff_attendance").select("id,business_id,branch_id,user_id,work_date,clock_in_at,clock_out_at,clock_in_note,clock_out_note").eq("business_id",businessId)).order("work_date",{ascending:false}).limit(100),
        (branchId ? supabase.from("cash_register_sessions").select("id,business_id,branch_id,cashier_id,opened_at,opening_float,closed_at,expected_cash,counted_cash,cash_difference,cash_sales,cash_outflows,opening_note,closing_note,status").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("cash_register_sessions").select("id,business_id,branch_id,cashier_id,opened_at,opening_float,closed_at,expected_cash,counted_cash,cash_difference,cash_sales,cash_outflows,opening_note,closing_note,status").eq("business_id",businessId)).order("opened_at",{ascending:false}).limit(100),
        (branchId ? supabase.from("stock_opnames").select("id,business_id,branch_id,warehouse_id,opname_no,status,notes,total_lines,total_difference,created_at,approved_at").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("stock_opnames").select("id,business_id,branch_id,warehouse_id,opname_no,status,notes,total_lines,total_difference,created_at,approved_at").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(100),
        supabase.from("stock_transfers").select("id,business_id,from_branch_id,to_branch_id,from_warehouse_id,to_warehouse_id,transfer_no,status,notes,total_lines,created_at,approved_at").eq("business_id",businessId).order("created_at",{ascending:false}).limit(100),
        (branchId ? supabase.from("sale_returns").select("id,business_id,branch_id,sale_id,return_no,reason,refund_method,refund_amount,restock,created_at,sale_return_items(id,sale_item_id,product_name,quantity,refund_amount)").eq("business_id",businessId).eq("branch_id",branchId) : supabase.from("sale_returns").select("id,business_id,branch_id,sale_id,return_no,reason,refund_method,refund_amount,restock,created_at,sale_return_items(id,sale_item_id,product_name,quantity,refund_amount)").eq("business_id",businessId)).order("created_at",{ascending:false}).limit(300)
      ]);
      for(const result of [bizRes,branchRes,warehouseRes,productRes,inventoryRes,categoryRes,customerRes,salesRes,suppliersRes,purchasesRes,paymentsRes,cashRes,tiersRes,warrantiesRes,claimsRes,attendanceRes,shiftRes,opnameRes,transferRes,returnsRes,loyaltyProgramRes,loyaltyLedgerRes,supplierReturnsRes]) if(result.error) throw result.error;
      let staffMembersData = [];
      if (["owner","admin","manager"].includes(member.role)) {
        const [membersRes,profilesRes] = await Promise.all([
          supabase.from("business_members").select("user_id,branch_id,role,is_active,created_at").eq("business_id",businessId).order("created_at"),
          supabase.from("staff_profiles").select("id,user_id,branch_id,employee_code,full_name,phone,job_title,commission_type,commission_value").eq("business_id",businessId)
        ]);
        if(membersRes.error) throw membersRes.error;
        if(profilesRes.error) throw profilesRes.error;
        const profileMap = Object.fromEntries((profilesRes.data||[]).map(p=>[p.user_id,p]));
        const [commissionRes,ledgerRes] = await Promise.all([supabase.from("commission_rules").select("id,business_id,branch_id,product_id,commission_type,commission_value,is_active").eq("business_id",businessId),supabase.from("commission_ledger").select("id,business_id,branch_id,sale_id,sale_item_id,staff_user_id,product_name,quantity,commission_base,commission_amount,status,created_at").eq("business_id",businessId).order("created_at",{ascending:false}).limit(500)]);
        if(commissionRes.error) throw commissionRes.error;
        if(ledgerRes.error) throw ledgerRes.error;
        setCommissionRules(commissionRes.data||[]); setCommissionLedger(ledgerRes.data||[]);
        staffMembersData = (membersRes.data||[]).map(m=>({...m,profile:profileMap[m.user_id]||null}));
      }
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
      setBusiness(bizRes.data); setMembership(member); setBranches(accessibleBranches); setWarehouses(warehouseRes.data); setInventoryRows(inventoryRes.data||[]);
      setBranchId(activeBranch?.id||""); setWarehouseId(activeWarehouse?.id||"");
      setProducts(productRes.data.map(p=>({...p,category:categoryMap[p.category_id]||"Umum",stock:stockMap[p.id]||0,price:Number(p.selling_price),cost:Number(p.cost_price),min:Number(p.min_stock),discountType:p.discount_type||"none",discountValue:Number(p.discount_value)||0,variant_parent_id:p.variant_parent_id||null,variant_label:p.variant_label||""})));
      setCustomers(customerRes.data); setSales(salesRes.data); setSaleReturns(returnsRes.data||[]); setMembershipTiers(tiersRes.data||[]);
      setLoyaltyProgram(loyaltyProgramRes.data||null); setLoyaltyLedger(loyaltyLedgerRes.data||[]); setSupplierReturns(supplierReturnsRes.data||[]);
      setLoyaltyDraft({is_enabled:Boolean(loyaltyProgramRes.data?.is_enabled),earn_amount_per_point:loyaltyProgramRes.data?.earn_amount_per_point??"",redemption_value_per_point:loyaltyProgramRes.data?.redemption_value_per_point??"",minimum_redeem_points:String(loyaltyProgramRes.data?.minimum_redeem_points??1)});
      setSuppliers(suppliersRes.data); setPurchases(purchasesRes.data); setSupplierPayments(paymentsRes.data||[]); setCashEntries(cashRes.data||[]); setWarranties(warrantiesRes.data||[]); setWarrantyClaims(claimsRes.data||[]); setAttendanceRows(attendanceRes.data||[]); setCashSessions(shiftRes.data||[]); setStockOpnames(opnameRes.data||[]); setStockTransfers(transferRes.data||[]); setStaffMembers(staffMembersData);
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

  async function createStockTransfer(){
    if(!warehouseId||!transferDestination||!transferProduct){setError("Pilih gudang tujuan dan produk.");return;}
    const quantity=Number(transferQuantity);
    if(!Number.isFinite(quantity)||quantity<=0){setError("Jumlah transfer harus lebih dari nol.");return;}
    setBusy(true);setError("");
    const {error:e}=await supabase.rpc("create_stock_transfer",{p_from_warehouse_id:warehouseId,p_to_warehouse_id:transferDestination,p_items:[{product_id:transferProduct,quantity}],p_notes:transferNotes||null});
    setBusy(false);if(e){setError(e.message);return;}
    setTransferProduct("");setTransferQuantity("1");setTransferNotes("");setNotice("Permintaan transfer stok dibuat. Menunggu persetujuan.");await loadData();
  }
  async function approveStockTransfer(row){
    if(!window.confirm("Setujui transfer "+row.transfer_no+"? Stok akan dipindahkan dari gudang asal ke gudang tujuan."))return;
    setBusy(true);setError("");
    const {error:e}=await supabase.rpc("approve_stock_transfer",{p_transfer_id:row.id});
    setBusy(false);if(e){setError(e.message);return;}
    setNotice("Transfer stok disetujui dan persediaan kedua gudang diperbarui.");await loadData();
  }

  async function createStockOpname(){
    if(!warehouseId||!branchId){setError("Pilih cabang dan gudang terlebih dahulu.");return;}
    const items=products.map(p=>({product_id:p.id,counted_quantity:Number(stockCountDraft[p.id]??p.stock)}));
    if(!items.length){setError("Belum ada produk untuk dihitung.");return;}
    if(items.some(x=>!Number.isFinite(x.counted_quantity)||x.counted_quantity<0)){setError("Jumlah fisik harus berupa angka nol atau lebih.");return;}
    setBusy(true);setError("");
    const {error:e}=await supabase.rpc("create_stock_opname",{p_branch_id:branchId,p_warehouse_id:warehouseId,p_items:items,p_notes:opnameNotes||null});
    setBusy(false);if(e){setError(e.message);return;}
    setStockCountDraft({});setOpnameNotes("");setNotice("Stok opname dibuat sebagai draft. Menunggu persetujuan Owner/Admin.");await loadData();
  }
  async function approveStockOpname(row){
    if(!window.confirm("Setujui "+row.opname_no+"? Stok gudang akan disesuaikan berdasarkan hasil hitung fisik."))return;
    setBusy(true);setError("");
    const {error:e}=await supabase.rpc("approve_stock_opname",{p_opname_id:row.id});
    setBusy(false);if(e){setError(e.message);return;}
    setNotice("Stok opname disetujui dan persediaan sudah disesuaikan.");await loadData();
  }

  function editStaffMember(row){
    const p=row.profile||{};
    setStaffDraft({user_id:row.user_id,employee_code:p.employee_code||"",full_name:p.full_name||"",phone:p.phone||"",job_title:p.job_title||"",branch_id:row.branch_id||p.branch_id||branchId,role:row.role==="owner"?"cashier":row.role,is_active:Boolean(row.is_active),commission_type:p.commission_type||"percent",commission_value:String(p.commission_value??0)});
  }
  async function saveCommissionRule(e){
    e.preventDefault();setBusy(true);setError("");
    const {error:e2}=await supabase.rpc("save_commission_rule",{p_branch_id:commissionRuleDraft.branch_id||null,p_product_id:commissionRuleDraft.product_id||null,p_commission_type:commissionRuleDraft.commission_type,p_commission_value:Number(commissionRuleDraft.commission_value)||0,p_is_active:true});
    setBusy(false);if(e2){setError(e2.message);return;}
    setNotice("Aturan komisi berhasil disimpan.");setCommissionRuleDraft({branch_id:"",product_id:"",commission_type:"percent",commission_value:"0"});await loadData();
  }

  async function payStaffCommission(staffUserId,staffName,amount){
    if(!window.confirm("Bayarkan seluruh komisi tertunda untuk "+staffName+" sebesar "+money(amount)+"? Pembayaran akan dicatat sebagai pengeluaran kas."))return;
    setBusy(true);setError("");
    const {data,error:e}=await supabase.rpc("pay_staff_commissions",{p_branch_id:branchId,p_staff_user_id:staffUserId,p_notes:null});
    setBusy(false);
    if(e){setError(e.message);return;}
    const paid=data?.[0];
    setNotice("Komisi dibayarkan: "+money(paid?.paid_amount||amount)+". Tercatat "+(paid?.paid_items||0)+" item.");
    await loadData();
  }

  async function createStaffAccount(e){
    e.preventDefault();setBusy(true);setError("");
    const {data,error}=await supabase.functions.invoke("staff-access",{body:{action:"create_staff",business_id:business.id,branch_id:staffDraft.branch_id||branchId,employee_code:staffDraft.employee_code,full_name:staffDraft.full_name,phone:staffDraft.phone,job_title:staffDraft.job_title,role:staffDraft.role,commission_type:staffDraft.commission_type,commission_value:Number(staffDraft.commission_value)||0,pin:staffDraft.pin}});
    setBusy(false);if(error||data?.error){setError(data?.error||error?.message||"Gagal membuat akun karyawan.");return;}
    setNotice("Akun "+staffDraft.full_name+" berhasil dibuat. Karyawan dapat masuk dengan kode dan PIN.");
    setStaffDraft({employee_code:"",full_name:"",phone:"",job_title:"",branch_id:branchId,role:"cashier",commission_type:"percent",commission_value:"0",pin:""});await loadData();
  }
  async function pairCurrentDevice(){
    if(!business?.id||!branchId)return;setBusy(true);setError("");
    const {data,error}=await supabase.functions.invoke("staff-access",{body:{action:"pair_device",business_id:business.id,branch_id:branchId,device_id:getStaffDeviceId(),device_label:(navigator.userAgent||"Perangkat kasir").slice(0,80)}});
    setBusy(false);if(error||data?.error){setError(data?.error||error?.message||"Gagal memasangkan perangkat.");return;}setNotice("Perangkat ini disetujui untuk cabang aktif. Karyawan dapat masuk menggunakan PIN.");
  }
  async function revokeCurrentDevice(){
    if(!window.confirm("Cabut akses login PIN pada perangkat ini? Karyawan tidak dapat masuk kembali sampai Owner memasangkannya lagi."))return;
    setBusy(true);setError("");
    const {data,error}=await supabase.functions.invoke("staff-access",{body:{action:"revoke_device",business_id:business.id,device_id:getStaffDeviceId()}});
    setBusy(false);if(error||data?.error){setError(data?.error||error?.message||"Gagal mencabut perangkat.");return;}setNotice("Akses PIN perangkat ini berhasil dicabut.");
  }
  async function resetStaffPin(profileId,staffName){
    const nextPin=window.prompt("Masukkan PIN baru 6 angka untuk "+staffName+":");if(nextPin===null)return;
    if(!/^\d{6}$/.test(nextPin)){setError("PIN harus tepat 6 angka.");return;}setBusy(true);setError("");
    const {data,error}=await supabase.functions.invoke("staff-access",{body:{action:"set_pin",business_id:business.id,staff_profile_id:profileId,pin:nextPin}});
    setBusy(false);if(error||data?.error){setError(data?.error||error?.message||"Gagal mengatur PIN.");return;}setNotice("PIN "+staffName+" berhasil diperbarui.");
  }
  async function toggleStaffActive(row){
    if(!row.profile?.employee_code)return;
    const next=!row.is_active;
    if(!window.confirm((next?"Aktifkan":"Nonaktifkan")+" akun "+(row.profile.full_name||"karyawan")+"?"))return;
    setBusy(true);setError("");
    const {error}=await supabase.rpc("save_staff_profile",{p_user_id:row.user_id,p_branch_id:row.branch_id||row.profile.branch_id,p_employee_code:row.profile.employee_code,p_full_name:row.profile.full_name,p_phone:row.profile.phone||null,p_job_title:row.profile.job_title||null,p_role:row.role,p_is_active:next,p_commission_type:row.profile.commission_type||"none",p_commission_value:Number(row.profile.commission_value)||0});
    setBusy(false);if(error){setError(error.message);return;}setNotice("Status akun karyawan diperbarui.");await loadData();
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

  const productStockCounts = useMemo(()=>({all:products.length,low:products.filter(p=>Number(p.stock)>0&&Number(p.stock)<=Number(p.min||0)).length,out:products.filter(p=>Number(p.stock)<=0).length}),[products]);
  const posProducts = useMemo(()=>products.filter(p=>p.variant_parent_id||!products.some(child=>child.variant_parent_id===p.id)),[products]);
  const posFilteredProducts = useMemo(()=>posProducts.filter(p=>{
    const matchesSearch=(p.name+" "+(p.sku||"")+" "+p.category).toLowerCase().includes(search.toLowerCase());
    const stock=Number(p.stock)||0,min=Number(p.min)||0;
    const matchesStock=productStockFilter==="all"||(productStockFilter==="low"&&stock>0&&stock<=min)||(productStockFilter==="out"&&stock<=0);
    return matchesSearch&&matchesStock;
  }),[posProducts,search,productStockFilter]);
  const filteredProducts = useMemo(()=>products.filter(p=>{
    const matchesSearch=(p.name+" "+(p.sku||"")+" "+p.category).toLowerCase().includes(search.toLowerCase());
    const stock=Number(p.stock)||0,min=Number(p.min)||0;
    const matchesStock=productStockFilter==="all"||(productStockFilter==="low"&&stock>0&&stock<=min)||(productStockFilter==="out"&&stock<=0);
    return matchesSearch&&matchesStock;
  }),[products,search,productStockFilter]);
  const cartSubtotal = cart.reduce((sum,item)=>sum+item.price*item.qty,0);
  const cartDiscount = cart.reduce((sum,item)=>sum+(Number(item.discountAmount)||0),0);
  const selectedCustomer = customers.find(c=>c.id===customerId);
  const selectedTier = membershipTiers.find(t=>t.tier_code===(selectedCustomer?.membership_tier||"silver") && t.is_active);
  const membershipDiscount = Math.round(Math.max(0,cartSubtotal-cartDiscount)*(Number(selectedTier?.discount_percent)||0)/100);
  const cartTotal = Math.max(0,cartSubtotal-cartDiscount-membershipDiscount);
  const todayKey = new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"});
  const todaySales = sales.filter(s=>new Date(s.created_at).toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"})===todayKey);
  const revenue = todaySales.reduce((sum,s)=>sum+Number(s.total),0);
  const reportRange = useMemo(()=>{
    const now=new Date();let start=null;let end=new Date(now);
    const dayStart=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x;};
    const dayEnd=d=>{const x=new Date(d);x.setHours(23,59,59,999);return x;};
    if(reportPeriod==="today"){start=dayStart(now);end=dayEnd(now);}
    else if(reportPeriod==="yesterday"){const d=new Date(now);d.setDate(d.getDate()-1);start=dayStart(d);end=dayEnd(d);}
    else if(reportPeriod==="week"){const d=dayStart(now);d.setDate(d.getDate()-((d.getDay()+6)%7));start=d;end=dayEnd(now);}
    else if(reportPeriod==="month"){const d=dayStart(now);d.setDate(1);start=d;end=dayEnd(now);}
    else if(reportPeriod==="year"){const d=dayStart(now);d.setMonth(0,1);start=d;end=dayEnd(now);}
    else if(reportPeriod==="custom"){start=reportStartDate?new Date(reportStartDate+"T00:00:00"):null;end=reportEndDate?new Date(reportEndDate+"T23:59:59.999"):null;}
    else if(reportPeriod!=="all"){start=new Date(now.getTime()-(Number(reportPeriod)||30)*86400000);end=now;}
    return {start,end};
  },[reportPeriod,reportStartDate,reportEndDate]);

  useEffect(()=>{
    if(!session?.user?.id || !business?.id || !branchId || !["owner","admin","manager"].includes(membership?.role)){
      setProfitLoss(null);
      return;
    }
    let alive=true;
    const endAt=reportRange.end||new Date();
    const startAt=reportRange.start?reportRange.start.toISOString():null;
    setProfitLossLoading(true);
    supabase.rpc("get_profit_loss_summary_v2",{
      p_business_id:business.id,
      p_branch_id:branchId,
      p_start_at:startAt,
      p_end_at:endAt.toISOString()
    }).then(({data,error})=>{
      if(!alive)return;
      if(error){setProfitLoss(null);setError("Laporan laba rugi gagal dimuat: "+error.message);}
      else setProfitLoss(Array.isArray(data)?(data[0]||null):data);
      setProfitLossLoading(false);
    });
    return ()=>{alive=false;};
  },[session?.user?.id,business?.id,branchId,reportRange,membership?.role]);
  const reportTransactions = useMemo(()=>sales.filter(s=>{
    const date=new Date(s.created_at);
    if(reportRange.start&&date<reportRange.start)return false;
    if(reportRange.end&&date>reportRange.end)return false;
    if(reportStaffFilter!=="all"&&s.cashier_id!==reportStaffFilter)return false;
    if(reportPaymentFilter!=="all"&&!(s.sale_payments||[]).some(p=>p.payment_method===reportPaymentFilter))return false;
    if(reportCategoryFilter!=="all"&&!(s.sale_items||[]).some(i=>products.find(p=>p.id===i.product_id)?.category===reportCategoryFilter))return false;
    return true;
  }),[sales,reportRange,reportStaffFilter,reportPaymentFilter,reportCategoryFilter,products]);
  const reportSales = useMemo(()=>reportTransactions.filter(s=>["paid","partial","refunded"].includes(s.status)),[reportTransactions]);
  const filteredReportTransactions = useMemo(()=>{
    const q=reportSearch.trim().toLowerCase();
    return q?reportTransactions.filter(s=>(s.invoice_no||"").toLowerCase().includes(q)||(s.status||"").toLowerCase().includes(q)):reportTransactions;
  },[reportTransactions,reportSearch]);
  const receivableRows = useMemo(()=>sales.filter(s=>s.status==="partial").map(s=>{const paid=(s.sale_payments||[]).filter(p=>p.payment_status==="completed").reduce((sum,p)=>sum+Number(p.amount||0),0);return {...s,paidAmount:paid,balanceDue:Math.max(0,Number(s.total||0)-paid)};}).filter(s=>s.balanceDue>0).sort((a,b)=>new Date(a.due_date||"9999-12-31")-new Date(b.due_date||"9999-12-31")),[sales]);
  const totalReceivables = receivableRows.reduce((sum,s)=>sum+s.balanceDue,0);
  const overdueReceivables = receivableRows.filter(s=>s.due_date&&s.due_date<new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"}));
  const paymentDraftTotal = paymentLines.reduce((sum,line)=>sum+(Number(line.amount)||0),0);
  const cashPaymentLine = paymentLines.find(line=>line.payment_method==="Tunai");
  const cashTendered = fullCredit?0:(cashPaymentLine?(cashPaymentLine.amount===""&&paymentLines.length===1?cartTotal:Number(cashPaymentLine.amount)||0):0);
  const nonCashTendered = fullCredit?0:paymentLines.filter(line=>line.payment_method!=="Tunai").reduce((sum,line)=>sum+(Number(line.amount)||0),0);
  const projectedPaid = fullCredit?0:Math.min(cartTotal,nonCashTendered+cashTendered);
  const projectedBalance = Math.max(0,cartTotal-projectedPaid);
  const projectedChange = Math.max(0,cashTendered-Math.max(0,cartTotal-nonCashTendered));
  const reportPaymentOptions = useMemo(()=>[...new Set(sales.flatMap(s=>(s.sale_payments||[]).map(p=>p.payment_method).filter(Boolean)))].sort(),[sales]);
  const reportCategoryOptions = useMemo(()=>[...new Set(products.map(p=>p.category).filter(Boolean))].sort(),[products]);
  const reportPurchases = useMemo(()=>purchases.filter(p=>{const d=new Date(p.created_at);return (!reportRange.start||d>=reportRange.start)&&(!reportRange.end||d<=reportRange.end);}),[purchases,reportRange]);
  const inventoryValuation = useMemo(()=>{
    const ids=new Set(warehouses.filter(w=>w.branch_id===branchId).map(w=>w.id));
    const costs=new Map(products.map(p=>[p.id,Number(p.cost_price??p.cost)||0]));
    return inventoryRows.filter(r=>ids.has(r.warehouse_id)).reduce((sum,r)=>sum+(Number(r.quantity)||0)*(costs.get(r.product_id)||0),0);
  },[inventoryRows,warehouses,branchId,products]);
  const reportMemberMetrics = useMemo(()=>{
    const newMembers=customers.filter(c=>{const d=new Date(c.created_at);return (!reportRange.start||d>=reportRange.start)&&(!reportRange.end||d<=reportRange.end);}).length;
    return {newMembers,silver:customers.filter(c=>(c.membership_tier||"silver")==="silver").length,gold:customers.filter(c=>c.membership_tier==="gold").length,platinum:customers.filter(c=>c.membership_tier==="platinum").length};
  },[customers,reportRange]);
  const reportCashEntries = useMemo(()=>cashEntries.filter(x=>{const d=new Date(x.created_at);return (!reportRange.start||d>=reportRange.start)&&(!reportRange.end||d<=reportRange.end);}),[cashEntries,reportRange]);
  const reportCommissionByStaff = useMemo(()=>{
    const rows=new Map();
    for(const x of commissionLedger.filter(x=>x.branch_id===branchId&&(!reportRange.start||new Date(x.created_at)>=reportRange.start)&&(!reportRange.end||new Date(x.created_at)<=reportRange.end))){const row=rows.get(x.staff_user_id)||{user_id:x.staff_user_id,pending:0,paid:0,total:0};const amount=Number(x.commission_amount)||0;if(x.status==="paid")row.paid+=amount;else if(x.status==="pending")row.pending+=amount;row.total+=amount;rows.set(x.staff_user_id,row);}
    return [...rows.values()].sort((a,b)=>b.total-a.total);
  },[commissionLedger,branchId,reportRange]);
  const reportDaily = useMemo(()=>{
    const map=new Map();
    for(const sale of reportSales){
      const key=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta"}).format(new Date(sale.created_at));
      map.set(key,(map.get(key)||0)+Number(sale.total||0));
    }
    const end=reportRange.end||new Date();
    const start=reportRange.start;
    const span=start?Math.ceil((end-start)/86400000)+1:30;
    const days=Math.max(1,Math.min(90,span));
    const chartStart=start&&span<=90?start:new Date(end.getTime()-(days-1)*86400000);
    const rows=[];
    for(let offset=0;offset<days;offset++){
      const d=new Date(chartStart.getTime()+offset*86400000);
      const key=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta"}).format(d);
      rows.push({key,label:new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",timeZone:"Asia/Jakarta"}).format(d),revenue:map.get(key)||0});
    }
    return rows;
  },[reportSales,reportRange]);
  const reportPaymentMethods = useMemo(()=>{
    const map=new Map();
    for(const sale of reportSales)for(const payment of sale.sale_payments||[]){
      if(payment.payment_status&&payment.payment_status!=="paid")continue;
      const key=payment.payment_method||"Tidak diketahui";
      map.set(key,(map.get(key)||0)+Number(payment.amount||0));
    }
    return [...map.entries()].map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount);
  },[reportSales]);
  const reportRevenue = reportSales.reduce((sum,s)=>sum+Number(s.total||0),0);
  const reportItems = useMemo(()=>{
    const rows = new Map();
    for (const sale of reportSales) for (const item of (sale.sale_items||[])) {
      const key = item.product_id || item.product_name;
      const product = products.find(p=>p.id===item.product_id);
      const row = rows.get(key) || {name:item.product_name||product?.name||"Produk",category:product?.category||"Umum",quantity:0,revenue:0};
      row.quantity += Number(item.quantity||0);
      row.revenue += Number(item.line_total ?? (Number(item.unit_price||0)*Number(item.quantity||0)-Number(item.discount||0)));
      rows.set(key,row);
    }
    return [...rows.values()].sort((a,b)=>b.revenue-a.revenue);
  },[reportSales,products]);
  const reportCategories = useMemo(()=>{
    const rows = new Map();
    for (const item of reportItems) { const row=rows.get(item.category)||{name:item.category,quantity:0,revenue:0}; row.quantity+=item.quantity; row.revenue+=item.revenue; rows.set(item.category,row); }
    return [...rows.values()].sort((a,b)=>b.revenue-a.revenue);
  },[reportItems]);
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
    const match=posProducts.find(p=>(p.barcode||"").toLowerCase()===code||(p.sku||"").toLowerCase()===code);
    if(match){addCart(match);setNotice("Barcode "+(match.barcode||match.sku)+" ditambahkan: "+match.name);setSearch("");if(continuousScan)setTimeout(()=>document.getElementById("pos-barcode-input")?.focus(),50);}
    else setNotice("Barcode/SKU tidak ditemukan: "+search);
  }

  function printProductLabels(){
    const selected=products.filter(p=>selectedLabelProducts.includes(p.id));
    if(!selected.length){setNotice("Pilih minimal satu produk untuk mencetak label.");return;}
    const sizes={"50x30":[50,30],"40x25":[40,25],"38x25":[38,25],"60x40":[60,40]};
    const [width,height]=sizes[labelSize]||sizes["50x30"];
    const labels=selected.flatMap(p=>Array.from({length:Math.max(1,Math.min(100,Number(labelCopies[p.id])||1))},()=>p));
    const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    const labelMarkup=labels.map(p=>{
      const code=p.barcode||p.sku;if(!code)return "";
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      try{JsBarcode(svg,String(code),{format:"CODE128",displayValue:true,font:"Arial",fontSize:8,height:Math.max(12,height*0.48),margin:0,width:1.2,lineColor:"#111",background:"#fff"});}catch(e){return "";}
      return '<div class="label"><div class="name">'+escapeHtml(p.name)+'</div>'+svg.outerHTML+'<div class="meta">'+escapeHtml(code)+' · '+escapeHtml(money(p.price))+'</div></div>';
    }).filter(Boolean).join("");
    if(!labelMarkup){setError("Produk yang dipilih belum memiliki barcode atau SKU yang valid.");return;}
    const w=window.open("","_blank","width=900,height=700");
    if(!w){setError("Izinkan pop-up browser untuk mencetak label.");return;}
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Label Produk Jatibarang Helmet</title><style>@page{margin:5mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0}.sheet{display:grid;grid-template-columns:repeat(auto-fill,'+width+'mm);gap:'+Math.max(0,Number(labelGap)||0)+'mm;padding:0}.label{width:'+width+'mm;height:'+height+'mm;border:0.2mm solid #ddd;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;padding:1mm;text-align:center;break-inside:avoid}.name{font-size:8pt;font-weight:700;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.label svg{max-width:100%;max-height:'+Math.max(12,height*0.48)+'mm}.meta{font-size:7pt;white-space:nowrap}</style></head><body><div class="sheet">'+labelMarkup+'</div><script>window.onload=()=>setTimeout(()=>window.print(),300)<\\/script></body></html>');
    w.document.close();
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
    const requestedPayments=fullCredit?[]:paymentLines.map(line=>({...line,amount:line.amount===""&&paymentLines.length===1?cartTotal:Number(line.amount)||0}));
    const nonCashTotal=requestedPayments.filter(line=>line.payment_method!=="Tunai").reduce((sum,line)=>sum+line.amount,0);
    if(nonCashTotal>cartTotal){setError("Total pembayaran non-tunai tidak boleh melebihi total transaksi.");return;}
    const cashLine=requestedPayments.find(line=>line.payment_method==="Tunai");
    const cashApplied=cashLine?Math.min(cashLine.amount,Math.max(0,cartTotal-nonCashTotal)):0;
    const changeAmount=cashLine?Math.max(0,cashLine.amount-cashApplied):0;
    const payments=requestedPayments.map(line=>line.payment_method==="Tunai"?({...line,amount:cashApplied}):line).filter(line=>line.amount>0);
    const paid=payments.reduce((sum,line)=>sum+line.amount,0);
    if(paid<cartTotal&&(!customerId||!paymentDueDate)){setError("Untuk uang muka/piutang, pilih pelanggan dan isi tanggal jatuh tempo.");return;}
    if(paymentLines.length>1&&payments.length!==paymentLines.length){setError("Isi nominal setiap metode pembayaran split bill.");return;}
    if(!payments.length&&cartTotal>0&&!fullCredit){setError("Masukkan minimal satu pembayaran atau pilih opsi seluruhnya piutang.");return;}
    const autoPrintWindow=null;
    setBusy(true);setError("");
    const {data,error:checkoutError}=await supabase.rpc("checkout_sale_with_payments",{
      p_business_id:business.id,p_branch_id:branchId,p_warehouse_id:warehouseId,
      p_customer_id:customerId||null,p_items:cart.map(item=>({product_id:item.id,quantity:item.qty,discount_amount:Number(item.discountAmount)||0})),
      p_payments:payments,p_due_date:paid<cartTotal?paymentDueDate:null,p_receivable_notes:paymentNotes||null
    });
    if(checkoutError){if(autoPrintWindow)autoPrintWindow.close();setError(checkoutError.message);setBusy(false);return;}
    const result=data?.[0];
    const completedReceipt={
      invoiceNo:result?.invoice_no||"—",
      createdAt:new Date().toISOString(),
      businessName:business?.name||"JATIBARANG HELMET",
      branchName:branches.find(b=>b.id===branchId)?.name||"Cabang utama",
      cashier:session?.user?.email||"Kasir",
      customerName:selectedCustomer?.name||"Pelanggan umum",
      customerCode:selectedCustomer?.customer_code||"",
      items:cart.map(item=>({name:item.name,sku:item.sku||"",qty:Number(item.qty)||0,price:Number(item.price)||0,discount:Number(item.discountAmount)||0})),
      subtotal:cartSubtotal,discount:cartDiscount+membershipDiscount,total:cartTotal,
      payments:payments.map(p=>({method:p.payment_method,amount:Number(p.amount)||0,reference:p.payment_reference||""})),
      paid:result?.paid_amount??paid,balance:result?.balance_due??Math.max(0,cartTotal-paid),change:changeAmount,
      status:(result?.balance_due??Math.max(0,cartTotal-paid))>0?"BELUM LUNAS":"LUNAS"
    };
    setReceiptData(completedReceipt);
    if(autoPrintReceipt){try{await printReceiptViaBluetoothBridge(completedReceipt);setNotice("Transaksi tersimpan dan struk berhasil dikirim ke printer Bluetooth.");}catch(printError){setError("Transaksi sudah tersimpan, tetapi struk belum tercetak: "+(printError.message||"Pastikan aplikasi Cleanter aktif dan printer terhubung."));}}
    setCart([]);setCustomerId("");setPaymentLines([{payment_method:"Tunai",amount:"",payment_reference:""}]);setPaymentDueDate("");setPaymentNotes("");setFullCredit(false);
    setNotice("Invoice "+(result?.invoice_no||"")+" tersimpan. Dibayar "+money(result?.paid_amount||0)+", kembalian "+money(changeAmount)+", sisa piutang "+money(result?.balance_due||0)+".");
    await loadData();
  }

  async function printReceiptViaBluetoothBridge(data){
    const bridge="http://localhost:9100";
    const health=await fetch(bridge+"/health",{method:"GET",signal:AbortSignal.timeout(2500)});
    if(!health.ok)throw new Error("Layanan printer tidak aktif. Buka Cleanter dan pilih printer VSC TM-58V.");
    const status=await health.json();
    if(status?.printer?.connected===false)throw new Error("Printer belum terhubung di Cleanter. Periksa Bluetooth dan pilih VSC TM-58V.");
    const blocks=[
      {type:"text",text:data.businessName||"JATIBARANG HELMET",align:"center",bold:true,size:"large"},
      {type:"text",text:data.branchName||"",align:"center"},
      {type:"text",text:"STRUK PEMBELIAN",align:"center"},
      {type:"divider"},
      {type:"row",left:"Invoice",right:String(data.invoiceNo||"—")},
      {type:"text",text:new Date(data.createdAt||Date.now()).toLocaleString("id-ID")},
      {type:"text",text:"Kasir: "+(data.cashier||"Kasir")},
      {type:"text",text:"Pelanggan: "+(data.customerName||"Pelanggan umum")},
      ...(data.customerCode?[{type:"text",text:"ID: "+data.customerCode}]:[]),
      {type:"divider"}
    ];
    for(const item of data.items||[]){
      blocks.push({type:"text",text:String(item.name||"Barang"),bold:true});
      blocks.push({type:"row",left:String(item.qty)+" x "+money(item.price),right:money(Math.max(0,item.price*item.qty-item.discount))});
      if(item.discount>0)blocks.push({type:"text",text:"Diskon: -"+money(item.discount),size:"small"});
    }
    blocks.push({type:"divider"},{type:"row",left:"Subtotal",right:money(data.subtotal)},{type:"row",left:"Diskon",right:"-"+money(data.discount)},{type:"row",left:"TOTAL",right:money(data.total),bold:true},{type:"divider"},{type:"text",text:"PEMBAYARAN",bold:true});
    for(const payment of data.payments||[])blocks.push({type:"row",left:String(payment.method||"Pembayaran"),right:money(payment.amount)});
    blocks.push({type:"row",left:"Dibayar",right:money(data.paid)},{type:"row",left:"Kembalian",right:money(data.change||0)},{type:"row",left:"Sisa tagihan",right:money(data.balance||0)},{type:"text",text:data.status||"",align:"center",bold:true},{type:"divider"},{type:"text",text:"Terima kasih telah berbelanja",align:"center"},{type:"text",text:"JATIBARANG HELMET",align:"center"},{type:"feed",lines:3});
    const response=await fetch(bridge+"/print",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:blocks,paperWidth:Number(receiptWidth),cut:true,reference:String(data.invoiceNo||"").slice(0,64)}),signal:AbortSignal.timeout(20000)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.fix||result.detail||result.error||("Layanan printer merespons "+response.status));
    return result;
  }

  function printThermalReceipt(data=receiptData,targetWindow=null){
    if(!data)return;
    const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    const rows=data.items.map(item=>{
      const lineTotal=Math.max(0,item.price*item.qty-item.discount);
      return '<div class="item"><div class="item-name">'+esc(item.name)+'</div><div class="item-meta">'+esc(item.qty)+' x '+esc(money(item.price))+'</div>'+(item.discount>0?'<div class="item-meta">Diskon: -'+esc(money(item.discount))+'</div>':'')+'<div class="item-total">'+esc(money(lineTotal))+'</div></div>';
    }).join("");
    const paymentRows=data.payments.map(p=>'<div class="row"><span>'+esc(p.method)+'</span><b>'+esc(money(p.amount))+'</b></div>').join("");
    const width=receiptWidth==="80"?"80mm":"58mm";
    const html=['<!doctype html><html><head><meta charset="utf-8"><title>Struk '+esc(data.invoiceNo)+'</title>',
      '<style>@page{size:'+width+' auto;margin:2mm}*{box-sizing:border-box}html,body{width:'+(receiptWidth==="80"?"76":"54")+'mm;margin:0;padding:0;color:#000;background:#fff;font-family:Arial,sans-serif;font-size:10px}.receipt{width:100%;padding:0}.center{text-align:center}.brand{font-size:14px;font-weight:800;letter-spacing:.3px}.muted{font-size:9px}.line{border:0;border-top:1px dashed #000;margin:7px 0}.row{display:flex;justify-content:space-between;gap:6px;margin:3px 0}.item{margin:6px 0}.item-name{font-weight:700;overflow-wrap:anywhere}.item-meta{font-size:9px;margin-top:2px}.item-total{text-align:right;font-weight:700}.grand{font-size:13px;font-weight:800}.status{font-weight:800;text-align:center;margin:8px 0}.thanks{text-align:center;font-size:9px;margin-top:10px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><main class="receipt">',
      '<div class="center"><div class="brand">'+esc(data.businessName)+'</div><div>'+esc(data.branchName)+'</div><div class="muted">STRUK PEMBELIAN</div></div><hr class="line">',
      '<div class="row"><span>No. Invoice</span><b>'+esc(data.invoiceNo)+'</b></div><div class="row"><span>Tanggal</span><span>'+esc(new Date(data.createdAt).toLocaleString("id-ID"))+'</span></div><div class="row"><span>Kasir</span><span>'+esc(data.cashier)+'</span></div><div class="row"><span>Pelanggan</span><span>'+esc(data.customerName)+'</span></div>'+(data.customerCode?'<div class="row"><span>ID Member</span><span>'+esc(data.customerCode)+'</span></div>':'')+'<hr class="line">',
      rows,'<hr class="line"><div class="row"><span>Subtotal</span><span>'+esc(money(data.subtotal))+'</span></div><div class="row"><span>Total diskon</span><span>- '+esc(money(data.discount))+'</span></div><div class="row grand"><span>TOTAL</span><span>'+esc(money(data.total))+'</span></div><hr class="line"><b>PEMBAYARAN</b>',
      paymentRows,'<div class="row"><span>Total dibayar</span><b>'+esc(money(data.paid))+'</b></div><div class="row"><span>Kembalian</span><b>'+esc(money(data.change||0))+'</b></div><div class="row"><span>Sisa tagihan</span><b>'+esc(money(data.balance))+'</b></div><div class="status">'+esc(data.status)+'</div><hr class="line"><div class="thanks">Terima kasih telah berbelanja<br>JATIBARANG HELMET</div></main><script>window.onload=function(){setTimeout(function(){window.print()},250)};<\/script></body></html>'].join("");
    const w=targetWindow||window.open("","_blank","width=420,height=700");
    if(!w){setError("Izinkan pop-up browser untuk mencetak struk.");return;}
    w.document.open();w.document.write(html);w.document.close();
  }

  async function connectBluetoothPrinter(){
    if(!navigator.bluetooth){setError("Browser ini tidak mendukung Web Bluetooth. Untuk printer Bluetooth thermal biasa (Classic/SPP), pasangkan dahulu melalui Pengaturan Bluetooth Android, lalu pilih printer pada dialog cetak.");return;}
    setPrinterBusy(true);setError("");
    try{const device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[]});
      if(!device.gatt)throw new Error("Perangkat terpilih tidak menyediakan koneksi BLE GATT. Printer Bluetooth thermal Classic/SPP biasanya harus dipasangkan melalui Pengaturan Bluetooth Android.");
      const server=await device.gatt.connect();
      setPrinterName(device.name||"Printer Bluetooth");setPrinterConnection({type:"bluetooth",status:"connected",name:device.name||"Printer Bluetooth"});
      device.addEventListener("gattserverdisconnected",()=>setPrinterConnection(current=>current.type==="bluetooth"?{type:"bluetooth",status:"disconnected",name:device.name||"Printer Bluetooth"}:current),{once:false});
      if(!server.connected)throw new Error("Koneksi Bluetooth belum aktif.");
      setNotice("Perangkat BLE "+(device.name||"printer")+" terhubung. Pencetakan struk tetap mengikuti layanan cetak yang didukung printer/browser.");
    }catch(e){if(e.name!=="NotFoundError")setError(e.message||"Tidak dapat menghubungkan perangkat Bluetooth.");}
    finally{setPrinterBusy(false);}
  }

  async function kickCashDrawer(){
    const device=usbPrinterDeviceRef.current;
    if(!device){setNotice("Cash drawer belum dapat dibuka otomatis. Hubungkan printer USB yang memiliki port laci uang dan mendukung ESC/POS.");return false;}
    let claimedInterface=null;
    try{
      if(!device.opened)await device.open();
      if(!device.configuration)await device.selectConfiguration(1);
      const iface=device.configuration?.interfaces?.find(item=>item.alternates?.some(alt=>alt.endpoints?.some(ep=>ep.direction==="out")));
      const endpoint=iface?.alternates?.flatMap(alt=>alt.endpoints||[]).find(ep=>ep.direction==="out");
      if(!iface||!endpoint)throw new Error("Printer USB tidak menyediakan endpoint keluaran ESC/POS.");
      await device.claimInterface(iface.interfaceNumber);claimedInterface=iface.interfaceNumber;
      const result=await device.transferOut(endpoint.endpointNumber,new Uint8Array([0x1b,0x70,0x00,0x19,0xfa]));
      if(result.status!=="ok")throw new Error("Printer tidak menerima perintah pembuka laci.");
      setNotice("Perintah buka cash drawer telah dikirim ke printer USB.");return true;
    }catch(e){setNotice("Cash drawer tidak terbuka: "+(e.message||"printer tidak mendukung perintah ESC/POS."));return false;}
    finally{try{if(claimedInterface!==null)await device.releaseInterface(claimedInterface);}catch{}try{if(device.opened)await device.close();}catch{}}
  }

  async function printReceiptWithDrawer(data=receiptData,targetWindow=null){
    const reservedWindow=targetWindow||window.open("","_blank","width=420,height=700");
    if(!reservedWindow){setError("Izinkan pop-up browser untuk mencetak struk.");return;}
    if(autoOpenCashDrawer)await kickCashDrawer();
    printThermalReceipt(data,reservedWindow);
  }

  async function connectUsbPrinter(){
    if(!navigator.usb){setError("Browser ini tidak mendukung WebUSB. Gunakan Chrome/Edge yang mendukung WebUSB atau pilih printer melalui layanan cetak Android.");return;}
    setPrinterBusy(true);setError("");
    try{const device=await navigator.usb.requestDevice({filters:[{classCode:7}]});
      usbPrinterDeviceRef.current=device;
      setPrinterName(device.productName||device.manufacturerName||"Printer USB");
      setPrinterConnection({type:"usb",status:"permission",name:device.productName||device.manufacturerName||"Printer USB"});
      setNotice("Izin akses USB diberikan untuk "+(device.productName||"printer")+". Pencetakan langsung ESC/POS belum tentu didukung perangkat; gunakan dialog cetak untuk mencetak struk.");
    }catch(e){if(e.name!=="NotFoundError")setError(e.message||"Tidak dapat memilih printer USB. Pastikan printer mendukung USB Printer Class.");}
    finally{setPrinterBusy(false);}
  }

  function disconnectPrinter(){
    usbPrinterDeviceRef.current=null;setPrinterConnection({type:"none",status:"disconnected",name:""});setPrinterName("");
    setNotice("Pilihan printer aplikasi dihapus. Perangkat tetap dapat tersimpan sebagai pasangan di pengaturan Android.");
  }

  function printPrinterTest(){
    const width=receiptWidth==="80"?"80mm":"58mm";
    const inner=receiptWidth==="80"?"76":"54";
    const html='<!doctype html><html><head><meta charset="utf-8"><title>Tes Printer Thermal</title><style>@page{size:'+width+' auto;margin:2mm}*{box-sizing:border-box}html,body{width:'+inner+'mm;margin:0;padding:0;font-family:Arial,sans-serif;color:#000}main{text-align:center;padding:4px;font-size:11px}.brand{font-size:15px;font-weight:800;margin:8px 0}.dash{border-top:1px dashed #000;margin:8px 0}.sample{font-size:10px;text-align:left;margin:8px 0}.total{font-size:14px;font-weight:800;margin:8px 0}</style></head><body><main><div class="brand">JATIBARANG HELMET</div><div>TES PRINTER THERMAL</div><div class="dash"></div><div class="sample">Ukuran kertas: '+width+'<br>Printer: '+(printerName.replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch])))+'<br>Teks: ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>Angka: 0123456789<br>Harga: Rp 125.000</div><div class="dash"></div><div class="total">TES CETAK BERHASIL</div><div>SMART POS JATIBARANG</div><div>Terima kasih</div></main><script>window.onload=function(){setTimeout(function(){window.print()},250)};<\\/script></body></html>';
    const w=window.open("","_blank","width=420,height=700");
    if(!w){setError("Izinkan pop-up browser untuk mencetak tes printer.");return;}
    w.document.open();w.document.write(html);w.document.close();
  }

  async function recordReceivablePayment(e){
    e.preventDefault();
    const sale=receivableRows.find(s=>s.id===selectedReceivableId);
    if(!sale){setError("Pilih invoice piutang terlebih dahulu.");return;}
    const amount=Number(receivablePaymentDraft.amount);
    if(!amount||amount<=0){setError("Masukkan nominal pembayaran yang valid.");return;}
    if(amount>sale.balanceDue){setError("Pembayaran melebihi sisa piutang.");return;}
    setBusy(true);setError("");
    const {data,error:e2}=await supabase.rpc("record_sale_payment",{p_sale_id:sale.id,p_payment_method:receivablePaymentDraft.payment_method,p_amount:amount,p_payment_reference:receivablePaymentDraft.payment_reference||null});
    setBusy(false);
    if(e2){setError(e2.message);return;}
    const result=data?.[0];
    setNotice("Pembayaran invoice "+sale.invoice_no+" berhasil. Sisa piutang "+money(result?.balance_due||0)+".");
    setReceivablePaymentDraft({payment_method:"Tunai",amount:"",payment_reference:""});setSelectedReceivableId("");await loadData();
  }

  async function processSaleReturn(e){
    e.preventDefault();
    const sale=sales.find(x=>x.id===selectedReturnSaleId);
    if(!sale){setError("Pilih transaksi yang akan diretur.");return;}
    const items=(sale.sale_items||[]).map(i=>({sale_item_id:i.id,quantity:Number(returnQtyDraft[i.id])||0})).filter(i=>i.quantity>0);
    if(!items.length){setError("Masukkan jumlah barang yang diretur.");return;}
    if(!returnReason.trim()){setError("Alasan retur wajib diisi.");return;}
    if(!window.confirm("Proses retur untuk invoice "+sale.invoice_no+"? Dana akan dicatat sebagai pengeluaran dan stok akan dikembalikan sesuai pilihan."))return;
    setBusy(true);setError("");
    const {data,error:e2}=await supabase.rpc("process_sale_return",{p_sale_id:sale.id,p_items:items,p_reason:returnReason.trim(),p_refund_method:returnMethod,p_restock:returnRestock});
    setBusy(false);
    if(e2){setError(e2.message);return;}
    const result=data?.[0];
    setNotice("Retur "+(result?.return_no||"berhasil")+" diproses. Pengembalian dana "+money(result?.refund_amount||0)+".");
    setReturnQtyDraft({});setReturnReason("");setSelectedReturnSaleId("");await loadData();
  }

  function beginEditProduct(product){
    const productRule=commissionRules.filter(r=>r.product_id===product.id).sort((a,b)=>Number(b.branch_id===branchId)-Number(a.branch_id===branchId))[0];
    setEditingProductId(product.id);
    setProductForm({
      name:product.name||"",sku:product.sku||"",barcode:product.barcode||"",category:product.category||"Umum",
      unit:product.unit||"pcs",cost_price:String(product.cost_price??product.cost??0),
      selling_price:String(product.selling_price??product.price??0),discount_type:product.discount_type||product.discountType||"none",
      discount_value:String(product.discount_value??product.discountValue??0),commission_type:productRule?(productRule.is_active?productRule.commission_type:"inherit"):"inherit",commission_value:String(productRule?.commission_value??0),min_stock:String(product.min_stock??product.min??0),
      initial_quantity:"0",warranty_months:String(product.warranty_months??0),
      warranty_coverage_percent:String(product.warranty_coverage_percent??0),
      warranty_max_amount:product.warranty_max_amount==null?"":String(product.warranty_max_amount),
      warranty_min_claim:String(product.warranty_min_claim??0),warranty_max_claims:String(product.warranty_max_claims??1),
      warranty_terms:product.warranty_terms||"",image_url:product.image_url||""
    });
    setProductImageFile(null);setProductImagePreview(product.image_url||"");setShowProductForm(true);
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function resetProductForm(){
    setEditingProductId("");setProductImageFile(null);setProductImagePreview("");
    setProductForm({name:"",sku:"",barcode:"",category:"Helm",unit:"pcs",cost_price:"",selling_price:"",discount_type:"none",discount_value:"0",commission_type:"inherit",commission_value:"0",min_stock:"3",initial_quantity:"0",warranty_months:"0",warranty_coverage_percent:"0",warranty_max_amount:"",warranty_min_claim:"0",warranty_max_claims:"1",warranty_terms:"",image_url:""});
    setShowProductForm(false);
  }

  async function uploadProductImage(productId){
    if(!productImageFile)return productForm.image_url||null;
    const file=productImageFile;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Foto harus JPG, PNG, atau WebP.");
    if(file.size>15*1024*1024)throw new Error("Ukuran foto sumber maksimal 15 MB.");
    let uploadBody=file;
    try{
      if(typeof createImageBitmap==="function"){
        const bitmap=await createImageBitmap(file);
        const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));
        canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const context=canvas.getContext("2d");
        context.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const compressed=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",0.86));
        bitmap.close?.();
        if(compressed&&compressed.size<file.size)uploadBody=compressed;
      }
    }catch(compressError){console.warn("Kompresi foto tidak tersedia; gunakan file asli.",compressError);}
    if(uploadBody.size>5*1024*1024)throw new Error("Foto setelah kompresi harus maksimal 5 MB. Pilih gambar yang lebih kecil.");
    const mime=uploadBody.type||file.type;
    const ext=mime==="image/webp"?"webp":mime==="image/png"?"png":"jpg";
    const path=business.id+"/"+productId+"/"+Date.now()+"-"+crypto.randomUUID()+"."+ext;
    const {error:uploadError}=await supabase.storage.from("product-images").upload(path,uploadBody,{cacheControl:"3600",upsert:false,contentType:mime});
    if(uploadError)throw uploadError;
    return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  }

  async function updateProductRecord(productId,imageUrl){
    return await supabase.rpc("update_product_details",{
      p_product_id:productId,p_name:productForm.name,p_sku:productForm.sku,p_barcode:productForm.barcode,
      p_category:productForm.category,p_unit:productForm.unit,p_cost_price:Number(productForm.cost_price)||0,
      p_selling_price:Number(productForm.selling_price)||0,p_min_stock:Number(productForm.min_stock)||0,
      p_discount_type:productForm.discount_type,p_discount_value:Number(productForm.discount_value)||0,
      p_warranty_months:Number(productForm.warranty_months)||0,p_warranty_coverage_percent:Number(productForm.warranty_coverage_percent)||0,
      p_warranty_max_amount:productForm.warranty_max_amount===""?null:Number(productForm.warranty_max_amount),
      p_warranty_min_claim:Number(productForm.warranty_min_claim)||0,p_warranty_max_claims:Number(productForm.warranty_max_claims)||1,
      p_warranty_terms:productForm.warranty_terms||null,p_image_url:imageUrl
    });
  }

  async function saveProduct(e){
    e.preventDefault();setBusy(true);setError("");
    try{
      let savedProductId=editingProductId;
      if(editingProductId){
        const imageUrl=await uploadProductImage(editingProductId);
        const {error:saveError}=await updateProductRecord(editingProductId,imageUrl);
        if(saveError)throw saveError;
        setNotice("Perubahan produk berhasil disimpan.");
      }else{
        const {data:productId,error:saveError}=await supabase.rpc("create_product_with_stock_discounted",{
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
        if(saveError)throw saveError;
        savedProductId=productId;
        if(productImageFile){
          const imageUrl=await uploadProductImage(productId);
          const {error:imageSaveError}=await updateProductRecord(productId,imageUrl);
          if(imageSaveError)throw imageSaveError;
        }
        setNotice("Produk dan stok awal berhasil disimpan.");
      }
      if(["owner","admin"].includes(membership?.role)&&savedProductId){
        const existingRule=commissionRules.filter(r=>r.product_id===savedProductId).sort((a,b)=>Number(b.branch_id===branchId)-Number(a.branch_id===branchId))[0];
        const {error:commissionError}=await supabase.rpc("save_commission_rule",{
          p_branch_id:existingRule?.branch_id??null,p_product_id:savedProductId,
          p_commission_type:productForm.commission_type==="inherit"?"none":productForm.commission_type,
          p_commission_value:Number(productForm.commission_value)||0,p_is_active:productForm.commission_type!=="inherit"
        });
        if(commissionError)throw new Error("Produk tersimpan, tetapi komisi belum tersimpan: "+commissionError.message);
      }
      resetProductForm();await loadData();
    }catch(saveError){setError(saveError.message||"Gagal menyimpan produk.");}
    finally{setBusy(false);}
  }

  async function createSupplierReturn(e){
    e.preventDefault();
    const purchase=purchases.find(p=>p.id===supplierReturnDraft.purchase_id);
    if(!purchase){setError("Pilih pembelian yang akan diretur.");return;}
    if(!supplierReturnDraft.reason.trim()){setError("Alasan retur wajib diisi.");return;}
    const items=(purchase.purchase_items||[]).map(item=>({purchase_item_id:item.id,quantity:Number(supplierReturnQuantities[item.id]||0)})).filter(x=>x.quantity>0);
    if(!items.length){setError("Masukkan jumlah minimal satu barang yang akan diretur.");return;}
    setBusy(true);setError("");
    const {error:e2}=await supabase.rpc("create_supplier_return",{p_purchase_id:purchase.id,p_items:items,p_reason:supplierReturnDraft.reason.trim(),p_notes:supplierReturnDraft.notes.trim()||null});
    setBusy(false);if(e2){setError(e2.message);return;}
    setSupplierReturnDraft({purchase_id:"",reason:"",notes:""});setSupplierReturnQuantities({});
    setNotice("Draft retur supplier berhasil dibuat. Menunggu persetujuan Owner/Admin.");await loadData();
  }
  async function approveSupplierReturn(row){
    if(!window.confirm("Setujui retur "+row.return_no+"? Stok gudang akan dikurangi sesuai jumlah barang."))return;
    setBusy(true);setError("");const {error:e2}=await supabase.rpc("approve_supplier_return",{p_return_id:row.id});
    setBusy(false);if(e2){setError(e2.message);return;}
    setNotice("Retur supplier disetujui dan stok telah diperbarui.");await loadData();
  }
  async function cancelSupplierReturn(row){
    const reason=window.prompt("Alasan pembatalan draft retur:");
    if(reason===null)return;if(reason.trim().length<3){setError("Alasan pembatalan minimal 3 karakter.");return;}
    setBusy(true);setError("");const {error:e2}=await supabase.rpc("cancel_supplier_return",{p_return_id:row.id,p_reason:reason.trim()});
    setBusy(false);if(e2){setError(e2.message);return;}
    setNotice("Draft retur supplier dibatalkan.");await loadData();
  }

  async function saveLoyaltyProgram(e){
    e.preventDefault();
    if(!business?.id||!["owner","admin"].includes(membership?.role)){setError("Hanya Owner/Admin yang dapat mengatur Loyalty Point.");return;}
    setBusy(true);setError("");
    const {error:e2}=await supabase.rpc("configure_loyalty_program",{
      p_business_id:business.id,p_is_enabled:Boolean(loyaltyDraft.is_enabled),
      p_earn_amount_per_point:loyaltyDraft.earn_amount_per_point===""?null:Number(loyaltyDraft.earn_amount_per_point),
      p_redemption_value_per_point:loyaltyDraft.redemption_value_per_point===""?null:Number(loyaltyDraft.redemption_value_per_point),
      p_minimum_redeem_points:Math.max(1,Number(loyaltyDraft.minimum_redeem_points)||1)
    });
    setBusy(false);if(e2){setError(e2.message);return;}
    setNotice("Pengaturan Loyalty Point berhasil disimpan.");await loadData();
  }

  async function redeemLoyaltyPoints(e){
    e.preventDefault();
    const points=Math.floor(Number(loyaltyRedeemDraft.points));
    if(!loyaltyRedeemDraft.customer_id||!Number.isInteger(points)||points<=0){setError("Pilih pelanggan dan masukkan jumlah poin yang valid.");return;}
    if(!loyaltyRedeemDraft.description.trim()){setError("Keterangan hadiah penukaran wajib diisi.");return;}
    if(!window.confirm("Catat penukaran "+points+" poin untuk pelanggan ini? Pastikan hadiah/barang penukaran benar-benar diberikan."))return;
    setBusy(true);setError("");
    const {error:e2}=await supabase.rpc("redeem_loyalty_points",{
      p_customer_id:loyaltyRedeemDraft.customer_id,p_points:points,p_branch_id:branchId||null,
      p_reference_id:crypto.randomUUID(),p_description:loyaltyRedeemDraft.description.trim()
    });
    setBusy(false);if(e2){setError(e2.message);return;}
    setLoyaltyRedeemDraft(d=>({...d,points:""}));setNotice("Penukaran poin berhasil dicatat.");await loadData();
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
  const visibleNav = ["owner","admin"].includes(membership?.role) ? NAV
    : membership?.role==="manager" ? NAV.filter(([name])=>name!=="Pengaturan")
    : membership?.role==="cashier" ? NAV.filter(([name])=>["Dashboard","Kasir","Pelanggan","Garansi","Karyawan & Shift"].includes(name))
    : NAV.filter(([name])=>["Dashboard","Karyawan & Shift"].includes(name));
  useEffect(()=>{if(membership&&!visibleNav.some(([name])=>name===page))setPage("Dashboard");},[membership?.role,page]);

  if(!supabaseConfigured)return <main className="auth-screen"><div className="auth-card"><h1>SMART POS JATIBARANG</h1><p>Koneksi Supabase belum dikonfigurasi pada deployment ini. Periksa Vercel Environment Variables lalu deploy ulang.</p></div></main>;
  if(authLoading)return <main className="auth-screen"><div className="auth-card">Memeriksa sesi akun...</div></main>;
  if(!session)return <Login onLogin={login}/>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">SJ</div><div><b>SMART POS</b><small>JATIBARANG HELMET</small></div></div>
      <nav className="sidebar-nav" aria-label="Navigasi utama"><div className="side-label">MENU UTAMA</div>{visibleNav.map(([name,icon])=><button key={name} className={page===name?"side-link active":"side-link"} onClick={()=>setPage(name)}><span>{icon}</span>{name}</button>)}</nav>
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
            <div className="product-grid">{posFilteredProducts.map(p=><button className="product-tile" key={p.id} onClick={()=>addCart(p)} disabled={p.stock<=0}>{p.image_url?<img className="product-thumb" src={p.image_url} alt={p.name}/>:<span className="product-symbol">◇</span>}<b>{p.name}</b><small>{p.sku||"Tanpa SKU"} · Stok {p.stock}</small><strong>{money(p.price)}</strong></button>)}</div>
            {posFilteredProducts.length===0&&<div className="empty">Belum ada produk. Tambahkan produk melalui menu Produk & Stok.</div>}</section>
            <section className="panel cart-panel"><div className="panel-head"><div><h3>Keranjang</h3><p>{cart.reduce((a,c)=>a+c.qty,0)} item dipilih</p></div><button className="text-btn" onClick={()=>setCart([])}>Kosongkan</button></div>
              {cart.length===0?<div className="empty">Keranjang masih kosong.</div>:cart.map(item=><div className="cart-row" key={item.id}><div><b>{item.name}</b><small>{money(item.price)} / item · Diskon {money(item.discountAmount||0)}</small><label className="discount-edit">Diskon total (Rp)<input type="number" min="0" max={item.price*item.qty} value={item.discountAmount||0} onChange={e=>setCart(old=>old.map(x=>x.id===item.id?{...x,discountAmount:Math.min(x.price*x.qty,Math.max(0,Number(e.target.value)||0))}:x))}/></label></div><div className="qty"><button onClick={()=>setCart(old=>old.map(x=>x.id===item.id?{...x,qty:x.qty-1,discountAmount:x.qty>1?Math.min(x.discountAmount||0,x.price*(x.qty-1)):0}:x).filter(x=>x.qty>0))}>−</button>{item.qty}<button onClick={()=>addCart(products.find(p=>p.id===item.id))}>＋</button></div></div>)}
              <div className="checkout-fields"><label>Scan ID pelanggan<input value={customerScan} onChange={e=>setCustomerScan(e.target.value)} onKeyDown={scanCustomer} placeholder="Scan barcode ID member lalu Enter"/></label><label>Pelanggan<select value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">Pelanggan umum</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.customer_code||c.id.slice(0,8)}</option>)}</select></label>
                <label className="check-label"><input type="checkbox" checked={fullCredit} onChange={e=>setFullCredit(e.target.checked)}/> Seluruh transaksi menjadi piutang (tanpa uang muka)</label>
                <div className="payment-builder" style={{opacity:fullCredit?0.45:1,pointerEvents:fullCredit?"none":"auto"}}><div className="panel-head"><div><h4>Metode pembayaran</h4><p>Satu metode, split bill, uang muka, atau piutang.</p></div><button type="button" className="text-btn" onClick={()=>setPaymentLines(lines=>[...lines,{payment_method:"Transfer bank",amount:"",payment_reference:""}])}>＋ Tambah metode</button></div>
                  {paymentLines.map((line,index)=><div className="form-grid payment-line" key={index}><label>Metode<select value={line.payment_method} onChange={e=>setPaymentLines(lines=>lines.map((v,i)=>i===index?{...v,payment_method:e.target.value}:v))}><option>Tunai</option><option>Transfer bank</option><option>QRIS</option><option>Debit</option></select></label><label>{line.payment_method==="Tunai"?"Uang tunai dari pembeli (Rp)":"Nominal pembayaran (Rp)"}<input type="number" min="0" step="1" placeholder={paymentLines.length===1?"Masukkan uang yang diserahkan":"Nominal metode ini"} value={line.amount} onChange={e=>setPaymentLines(lines=>lines.map((v,i)=>i===index?{...v,amount:e.target.value}:v))}/></label><label>Referensi (opsional)<input value={line.payment_reference} onChange={e=>setPaymentLines(lines=>lines.map((v,i)=>i===index?{...v,payment_reference:e.target.value}:v))}/></label>{paymentLines.length>1&&<button type="button" className="text-btn" onClick={()=>setPaymentLines(lines=>lines.filter((_,i)=>i!==index))}>Hapus metode</button>}</div>)}
                </div></div>
              <div className="total-line"><span>Subtotal</span><strong>{money(cartSubtotal)}</strong></div><div className="total-line"><span>Diskon produk</span><strong>− {money(cartDiscount)}</strong></div>{membershipDiscount>0&&<div className="total-line"><span>Diskon member {selectedTier?.tier_name||"Member"}</span><strong>− {money(membershipDiscount)}</strong></div>}<div className="total-line"><span>Total transaksi</span><strong>{money(cartTotal)}</strong></div><div className="total-line"><span>Total pembayaran masuk</span><strong>{money(projectedPaid)}</strong></div><div className="total-line"><span>Sisa tagihan</span><strong>{money(projectedBalance)}</strong></div><div className="total-line" style={{fontSize:18,color:"#087443"}}><span><b>KEMBALIAN</b></span><strong>{money(projectedChange)}</strong></div>
              {projectedBalance>0&&<div className="form-grid"><label>Tanggal jatuh tempo<input type="date" min={new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"})} value={paymentDueDate} onChange={e=>setPaymentDueDate(e.target.value)} required/></label><label>Catatan piutang<input value={paymentNotes} onChange={e=>setPaymentNotes(e.target.value)} placeholder="Contoh: pelunasan saat pengambilan"/></label><small>Piutang hanya dapat dibuat jika pelanggan sudah dipilih di atas.</small></div>}
              <button className="primary full" disabled={!cart.length||busy||!warehouseId} onClick={checkout}>Simpan transaksi & pembayaran</button>
            </section></div></>}
        {page==="Piutang Pelanggan"&&<><div className="welcome"><div><span className="eyebrow">CUSTOMER RECEIVABLES</span><h1>Piutang Pelanggan</h1><p>Pantau uang muka, sisa tagihan, tanggal jatuh tempo, dan catat pelunasan pelanggan.</p></div><button className="secondary" onClick={loadData}>↻ Segarkan</button></div>
          <div className="stats-grid"><div className="stat-card"><span>Total piutang aktif</span><strong>{money(totalReceivables)}</strong></div><div className="stat-card"><span>Invoice belum lunas</span><strong>{receivableRows.length}</strong></div><div className="stat-card"><span>Sudah jatuh tempo</span><strong>{overdueReceivables.length}</strong></div></div>
          <section className="panel"><div className="panel-head"><div><h3>Daftar tagihan pelanggan</h3><p>Nilai terbayar dan saldo dihitung dari seluruh pembayaran yang tervalidasi.</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>PELANGGAN</th><th>TANGGAL</th><th>JATUH TEMPO</th><th>TOTAL</th><th>DIBAYAR</th><th>SISA TAGIHAN</th><th>STATUS</th></tr></thead><tbody>{receivableRows.map(s=>{const customer=customers.find(c=>c.id===s.customer_id);const overdue=s.due_date&&s.due_date<new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Jakarta"});return <tr key={s.id}><td><b>{s.invoice_no}</b></td><td>{customer?.name||"Pelanggan"}</td><td>{new Date(s.created_at).toLocaleDateString("id-ID")}</td><td><span className={overdue?"badge red":"badge yellow"}>{s.due_date?new Date(s.due_date+"T00:00:00").toLocaleDateString("id-ID"):"Belum diatur"}</span></td><td>{money(s.total)}</td><td>{money(s.paidAmount)}</td><td className="amount">{money(s.balanceDue)}</td><td><button className="text-btn" onClick={()=>setSelectedReceivableId(s.id)}>Catat pembayaran</button></td></tr>;})}</tbody></table></div>
            {receivableRows.length===0&&<div className="empty">Tidak ada piutang aktif. Semua invoice sudah lunas.</div>}
          </section>
          {selectedReceivableId&&(()=>{const sale=receivableRows.find(s=>s.id===selectedReceivableId);if(!sale)return null;return <section className="panel"><div className="panel-head"><div><h3>Terima pembayaran — {sale.invoice_no}</h3><p>Sisa tagihan: <b>{money(sale.balanceDue)}</b></p></div><button className="text-btn" onClick={()=>setSelectedReceivableId("")}>Tutup</button></div>
            <div className="table-wrap"><table><thead><tr><th>TANGGAL</th><th>METODE</th><th>REFERENSI</th><th>NOMINAL</th></tr></thead><tbody>{(sale.sale_payments||[]).filter(p=>p.payment_status==="completed").map(p=><tr key={p.id}><td>{new Date(p.created_at).toLocaleString("id-ID")}</td><td>{p.payment_method}</td><td>{p.payment_reference||"—"}</td><td>{money(p.amount)}</td></tr>)}</tbody></table></div>
            <form className="form-grid" onSubmit={recordReceivablePayment}><label>Metode pembayaran<select value={receivablePaymentDraft.payment_method} onChange={e=>setReceivablePaymentDraft(v=>({...v,payment_method:e.target.value}))}><option>Tunai</option><option>Transfer bank</option><option>QRIS</option><option>Debit</option></select></label><label>Nominal diterima (Rp)<input type="number" min="1" max={sale.balanceDue} value={receivablePaymentDraft.amount} onChange={e=>setReceivablePaymentDraft(v=>({...v,amount:e.target.value}))} required/></label><label>Nomor referensi (opsional)<input value={receivablePaymentDraft.payment_reference} onChange={e=>setReceivablePaymentDraft(v=>({...v,payment_reference:e.target.value}))}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pembayaran</button></div></form>
          </section>;})()}
        </>}
        {page==="Retur Penjualan"&&<><div className="welcome"><div><span className="eyebrow">REFUND & INVENTORY CONTROL</span><h1>Retur Penjualan</h1><p>Proses pengembalian sebagian atau seluruh barang dari invoice. Setiap retur tercatat di kas, stok, dan audit.</p></div><button className="secondary" onClick={loadData}>↻ Segarkan</button></div>
          {["owner","admin","manager"].includes(membership?.role)?<section className="panel"><div className="panel-head"><div><h3>Buat retur dari invoice</h3><p>Jumlah retur dibatasi oleh sisa barang yang belum pernah dikembalikan.</p></div></div>
            <label>Cari nomor invoice<input value={returnSearch} onChange={e=>setReturnSearch(e.target.value)} placeholder="Ketik nomor invoice"/></label>
            <label>Pilih transaksi<select value={selectedReturnSaleId} onChange={e=>{setSelectedReturnSaleId(e.target.value);setReturnQtyDraft({});}}><option value="">Pilih invoice lunas</option>{sales.filter(s=>["paid","refunded"].includes(s.status)&&(!returnSearch||s.invoice_no.toLowerCase().includes(returnSearch.toLowerCase()))).map(s=><option key={s.id} value={s.id}>{s.invoice_no} · {new Date(s.created_at).toLocaleDateString("id-ID")} · {money(s.total)}{s.status==="refunded"?" · Diretur penuh":""}</option>)}</select></label>
            {(()=>{const sale=sales.find(s=>s.id===selectedReturnSaleId);if(!sale)return <div className="empty">Pilih invoice untuk melihat barang yang dapat diretur.</div>;return <form onSubmit={processSaleReturn}><div className="table-wrap"><table><thead><tr><th>PRODUK</th><th>TERJUAL</th><th>SUDAH DIRETUR</th><th>SISA</th><th>JUMLAH RETUR</th></tr></thead><tbody>{(sale.sale_items||[]).map(item=>{const returned=saleReturns.flatMap(r=>r.sale_return_items||[]).filter(x=>x.sale_item_id===item.id).reduce((sum,x)=>sum+Number(x.quantity||0),0);const remaining=Math.max(0,Number(item.quantity)-returned);return <tr key={item.id}><td>{item.product_name}</td><td>{item.quantity}</td><td>{returned}</td><td>{remaining}</td><td><input aria-label={"Jumlah retur "+item.product_name} type="number" min="0" max={remaining} step="0.001" value={returnQtyDraft[item.id]||""} disabled={remaining<=0} onChange={e=>setReturnQtyDraft(old=>({...old,[item.id]:e.target.value}))}/></td></tr>;})}</tbody></table></div>
              <div className="form-grid"><label>Alasan retur<input required minLength="3" maxLength="500" value={returnReason} onChange={e=>setReturnReason(e.target.value)} placeholder="Contoh: ukuran tidak sesuai"/></label><label>Metode pengembalian dana<select value={returnMethod} onChange={e=>setReturnMethod(e.target.value)}><option>Tunai</option><option>Transfer bank</option><option>QRIS</option><option>Debit</option></select></label><label className="check-label"><input type="checkbox" checked={returnRestock} onChange={e=>setReturnRestock(e.target.checked)}/> Barang layak jual, kembalikan ke stok gudang asal</label></div><div className="form-actions"><button className="primary" disabled={busy}>Proses retur & pengembalian dana</button></div></form>;})()}
          </section>:<div className="panel"><div className="notice">Retur hanya dapat diproses oleh Owner, Admin, atau Manager.</div></div>}
          <section className="panel"><div className="panel-head"><div><h3>Riwayat retur</h3><p>Daftar pengembalian dana yang tercatat di cabang aktif.</p></div></div><div className="table-wrap"><table><thead><tr><th>TANGGAL</th><th>NO. RETUR</th><th>INVOICE</th><th>ALASAN</th><th>METODE</th><th>STOK</th><th>DANA KEMBALI</th></tr></thead><tbody>{saleReturns.map(r=><tr key={r.id}><td>{new Date(r.created_at).toLocaleString("id-ID")}</td><td>{r.return_no}</td><td>{sales.find(s=>s.id===r.sale_id)?.invoice_no||"—"}</td><td>{r.reason}</td><td>{r.refund_method}</td><td>{r.restock?"Dikembalikan":"Tidak"}</td><td className="amount">{money(r.refund_amount)}</td></tr>)}</tbody></table></div>{saleReturns.length===0&&<div className="empty">Belum ada retur pada cabang ini.</div>}</section>
        </>}
        {page==="Produk & Stok"&&<><div className="welcome"><div><span className="eyebrow">INVENTARIS</span><h1>Produk & Stok</h1><p>Katalog dan jumlah stok dari gudang Supabase.</p></div><button className="primary" onClick={()=>{if(showProductForm){resetProductForm();}else{setEditingProductId("");setProductImageFile(null);setProductImagePreview("");setShowProductForm(true);}}}>＋ Tambah produk</button></div>
          {showProductForm&&<form className="panel form-grid product-editor" onSubmit={saveProduct}>
            <div className="form-section-title">{editingProductId?"Edit informasi produk":"Tambah produk baru"}</div>
            <div className="product-photo-field"><div className="product-photo-preview">{productImagePreview?<img src={productImagePreview} alt="Pratinjau foto produk"/>:<span>Foto produk</span>}</div><label>Foto produk (JPG, PNG, WebP · maks. 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0]||null;setProductImageFile(f);if(f){const url=URL.createObjectURL(f);setProductImagePreview(url);}else setProductImagePreview(productForm.image_url||"");}}/></label>{productImageFile&&<button type="button" className="text-btn" onClick={()=>{setProductImageFile(null);setProductImagePreview(productForm.image_url||"");}}>Batalkan foto baru</button>}</div>
            <label>Nama produk<input required maxLength="180" value={productForm.name} onChange={e=>setProductForm({...productForm,name:e.target.value})}/></label>
            <label>SKU<input value={productForm.sku} onChange={e=>setProductForm({...productForm,sku:e.target.value})}/></label>
            <label>Barcode<input value={productForm.barcode} onChange={e=>setProductForm({...productForm,barcode:e.target.value})}/></label>
            <label>Kategori<input value={productForm.category} onChange={e=>setProductForm({...productForm,category:e.target.value})}/></label>
            <label>Satuan<input value={productForm.unit} onChange={e=>setProductForm({...productForm,unit:e.target.value})}/></label>
            <label>Harga modal<input type="number" min="0" required value={productForm.cost_price} onChange={e=>setProductForm({...productForm,cost_price:e.target.value})}/></label>
            <label>Harga jual<input type="number" min="0" required value={productForm.selling_price} onChange={e=>setProductForm({...productForm,selling_price:e.target.value})}/></label>
            <label>Jenis diskon<select value={productForm.discount_type} onChange={e=>setProductForm({...productForm,discount_type:e.target.value})}><option value="none">Tanpa diskon</option><option value="percent">Persentase (%)</option><option value="fixed">Nominal (Rp) per barang</option></select></label>
            <label>Nilai diskon<input type="number" min="0" max={productForm.discount_type==="percent"?100:undefined} value={productForm.discount_value} onChange={e=>setProductForm({...productForm,discount_value:e.target.value})}/></label>
            {["owner","admin"].includes(membership?.role)&&<><div className="form-section-title">Komisi penjualan produk</div><div className="notice span-2">Komisi otomatis dihitung saat produk terjual dan transaksi lunas. Komisi menjadi beban penjualan yang mengurangi laba bersih, bukan menambah HPP barang. Pembayaran komisi nanti dicatat sebagai arus kas tanpa mengurangi laba dua kali.</div><label>Aturan komisi<select value={productForm.commission_type} onChange={e=>setProductForm({...productForm,commission_type:e.target.value})}><option value="inherit">Ikuti komisi default karyawan</option><option value="none">Tidak ada komisi untuk produk ini</option><option value="percent">Persentase dari nilai penjualan (%)</option><option value="per_unit">Nominal tetap per unit (Rp)</option></select></label><label>{productForm.commission_type==="percent"?"Komisi (%)":"Komisi per unit (Rp)"}<input type="number" min="0" max={productForm.commission_type==="percent"?100:100000000} step="0.01" disabled={["inherit","none"].includes(productForm.commission_type)} value={productForm.commission_value} onChange={e=>setProductForm({...productForm,commission_value:e.target.value})}/></label></>}
            <label>Stok minimum<input type="number" min="0" value={productForm.min_stock} onChange={e=>setProductForm({...productForm,min_stock:e.target.value})}/></label>
            {!editingProductId&&<label>Stok awal<input type="number" min="0" value={productForm.initial_quantity} onChange={e=>setProductForm({...productForm,initial_quantity:e.target.value})}/></label>}
            {editingProductId&&<div className="notice">Edit produk tidak mengubah stok. Gunakan menu Stok Opname atau Transfer Stok untuk penyesuaian persediaan.</div>}
            <div className="form-section-title">Pengaturan garansi (opsional)</div>
            <label>Masa garansi (bulan)<input type="number" min="0" max="120" value={productForm.warranty_months} onChange={e=>setProductForm({...productForm,warranty_months:e.target.value})}/></label>
            <label>Perlindungan (%)<input type="number" min="0" max="100" step="0.5" value={productForm.warranty_coverage_percent} onChange={e=>setProductForm({...productForm,warranty_coverage_percent:e.target.value})}/></label>
            <label>Batas maksimal perlindungan (Rp)<input type="number" min="0" value={productForm.warranty_max_amount} onChange={e=>setProductForm({...productForm,warranty_max_amount:e.target.value})} placeholder="Kosong = tanpa batas"/></label>
            <label>Minimal nilai klaim (Rp)<input type="number" min="0" value={productForm.warranty_min_claim} onChange={e=>setProductForm({...productForm,warranty_min_claim:e.target.value})}/></label>
            <label>Maksimal jumlah klaim<input type="number" min="1" max="20" value={productForm.warranty_max_claims} onChange={e=>setProductForm({...productForm,warranty_max_claims:e.target.value})}/></label>
            <label className="span-2">Ketentuan garansi<textarea rows="2" maxLength="2000" value={productForm.warranty_terms} onChange={e=>setProductForm({...productForm,warranty_terms:e.target.value})} placeholder="Syarat dan pengecualian garansi"/></label>
            <div className="form-actions"><button className="primary" disabled={busy||!warehouseId}>{busy?"Menyimpan...":editingProductId?"Simpan perubahan":"Simpan produk"}</button><button type="button" className="secondary" onClick={resetProductForm}>Batal</button></div>
          </form>}
          {membership&&["owner","admin","manager"].includes(membership.role)&&<section className="panel"><div className="panel-head"><div><h3>Varian produk</h3><p>Buat ukuran, warna, model, atau tipe sebagai SKU/barcode tersendiri. Setiap varian memakai stok gudang dan alur kasir yang sama seperti produk biasa.</p></div><button type="button" className="primary" onClick={()=>{setVariantForm({parent_product_id:products.find(p=>!p.variant_parent_id)?.id||"",variant_label:"",sku:"",barcode:"",cost_price:"",selling_price:"",min_stock:"3",initial_quantity:"0"});setShowVariantForm(v=>!v);}}>＋ Tambah varian</button></div>{showVariantForm&&<form className="form-grid" onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");const parent=products.find(p=>p.id===variantForm.parent_product_id);const {data,error:e2}=await supabase.rpc("create_product_variant",{p_parent_product_id:variantForm.parent_product_id,p_branch_id:branchId,p_warehouse_id:warehouseId,p_variant_label:variantForm.variant_label,p_sku:variantForm.sku||null,p_barcode:variantForm.barcode||null,p_cost_price:variantForm.cost_price===""?parent?.cost_price:Number(variantForm.cost_price),p_selling_price:variantForm.selling_price===""?parent?.selling_price:Number(variantForm.selling_price),p_min_stock:Number(variantForm.min_stock)||0,p_initial_quantity:Number(variantForm.initial_quantity)||0});setBusy(false);if(e2){setError(e2.message);return;}setNotice("Varian "+variantForm.variant_label+" berhasil dibuat. SKU dan stok terpisah.");setShowVariantForm(false);await loadData();}}><label>Produk induk<select required value={variantForm.parent_product_id} onChange={e=>{const p=products.find(x=>x.id===e.target.value);setVariantForm(v=>({...v,parent_product_id:e.target.value,cost_price:String(p?.cost_price??""),selling_price:String(p?.selling_price??"")}));}}>{products.filter(p=>!p.variant_parent_id).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Varian (ukuran/warna/model)<input required maxLength="100" value={variantForm.variant_label} onChange={e=>setVariantForm(v=>({...v,variant_label:e.target.value}))} placeholder="Contoh: Full Face - Hitam - L"/></label><label>SKU unik<input value={variantForm.sku} onChange={e=>setVariantForm(v=>({...v,sku:e.target.value}))}/></label><label>Barcode unik<input value={variantForm.barcode} onChange={e=>setVariantForm(v=>({...v,barcode:e.target.value}))}/></label><label>Harga modal<input type="number" min="0" required value={variantForm.cost_price} onChange={e=>setVariantForm(v=>({...v,cost_price:e.target.value}))}/></label><label>Harga jual<input type="number" min="0" required value={variantForm.selling_price} onChange={e=>setVariantForm(v=>({...v,selling_price:e.target.value}))}/></label><label>Stok minimum<input type="number" min="0" value={variantForm.min_stock} onChange={e=>setVariantForm(v=>({...v,min_stock:e.target.value}))}/></label><label>Stok awal gudang aktif<input type="number" min="0" value={variantForm.initial_quantity} onChange={e=>setVariantForm(v=>({...v,initial_quantity:e.target.value}))}/></label><div className="form-actions"><button className="primary" disabled={busy||!warehouseId}>{busy?"Menyimpan...":"Simpan varian"}</button><button type="button" className="secondary" onClick={()=>setShowVariantForm(false)}>Batal</button></div></form>}<div className="table-wrap"><table><thead><tr><th>PRODUK INDUK</th><th>VARIAN</th><th>SKU</th><th>BARCODE</th><th>HARGA JUAL</th><th>STOK</th></tr></thead><tbody>{products.filter(p=>p.variant_parent_id).map(p=><tr key={p.id}><td>{products.find(parent=>parent.id===p.variant_parent_id)?.name||"Produk"}</td><td><b>{p.variant_label}</b></td><td>{p.sku||"—"}</td><td>{p.barcode||"—"}</td><td>{money(p.selling_price)}</td><td>{p.stock} {p.unit}</td></tr>)}</tbody></table></div>{products.every(p=>!p.variant_parent_id)&&<div className="empty">Belum ada varian produk.</div>}</section>}
          <section className="panel"><div className="product-catalog-toolbar"><div className="searchbar"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari nama produk, SKU, atau kategori..."/></div><div style={{display:"flex",alignItems:"end",gap:8,flexWrap:"wrap"}}><label style={{fontSize:11}}>Ukuran label<select style={{display:"block",padding:7}} value={labelSize} onChange={e=>setLabelSize(e.target.value)}><option value="50x30">50 × 30 mm</option><option value="40x25">40 × 25 mm</option><option value="38x25">38 × 25 mm</option><option value="60x40">60 × 40 mm</option></select></label><label style={{fontSize:11}}>Jarak (mm)<input style={{display:"block",width:65,padding:7}} type="number" min="0" max="10" step="0.5" value={labelGap} onChange={e=>setLabelGap(e.target.value)}/></label><button type="button" className="secondary small" disabled={!selectedLabelProducts.length} onClick={printProductLabels}>▤ Cetak label ({selectedLabelProducts.length})</button></div><div className="product-view-toggle"><button type="button" className={productViewMode==="grid"?"active":""} onClick={()=>setProductViewMode("grid")}>▦ Grid</button><button type="button" className={productViewMode==="list"?"active":""} onClick={()=>setProductViewMode("list")}>☷ List</button></div></div><div className="product-stock-filters"><button type="button" className={productStockFilter==="all"?"active":""} onClick={()=>setProductStockFilter("all")}>Semua produk <b>{productStockCounts.all}</b></button><button type="button" className={productStockFilter==="low"?"active":""} onClick={()=>setProductStockFilter("low")}>Stok menipis <b>{productStockCounts.low}</b></button><button type="button" className={productStockFilter==="out"?"active":""} onClick={()=>setProductStockFilter("out")}>Stok habis <b>{productStockCounts.out}</b></button></div>{productViewMode==="grid"?<div className="product-grid">{filteredProducts.map(p=><article className="product-card" key={p.id}><label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,padding:6}}><input type="checkbox" checked={selectedLabelProducts.includes(p.id)} onChange={e=>setSelectedLabelProducts(rows=>e.target.checked?[...rows,p.id]:rows.filter(id=>id!==p.id))}/> Label <input aria-label="Jumlah label" style={{width:48}} type="number" min="1" max="100" value={labelCopies[p.id]||1} onChange={e=>setLabelCopies(rows=>({...rows,[p.id]:e.target.value}))}/></label><div className="product-card-photo">{p.image_url?<img src={p.image_url} alt={p.name}/>:<span>Foto belum tersedia</span>}<span className={p.stock<=0?"badge red":p.stock<=p.min?"badge yellow":"badge green"}>{p.stock<=0?"Habis":p.stock<=p.min?"Menipis":"Aman"}</span></div><div className="product-card-body"><div><h4>{p.name}</h4><small>{p.sku||"SKU belum diisi"} · {p.category}</small></div><strong>{money(p.price)}</strong><div className="product-card-meta"><span>Stok: {p.stock} {p.unit||"pcs"}</span><span>{p.discountType==="percent"?p.discountValue+"% diskon":p.discountType==="fixed"?money(p.discountValue)+" diskon":"Harga normal"}</span></div><button type="button" className="secondary small" onClick={()=>beginEditProduct(p)}>Edit produk</button></div></article>)}</div>:<div className="table-wrap"><table><thead><tr><th>CETAK</th><th>FOTO</th><th>PRODUK</th><th>SKU</th><th>KATEGORI</th><th>HARGA JUAL</th><th>DISKON</th><th>GARANSI</th><th>STOK</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>{filteredProducts.map(p=><tr key={p.id}><td><label style={{display:"flex",alignItems:"center",gap:4}}><input type="checkbox" checked={selectedLabelProducts.includes(p.id)} onChange={e=>setSelectedLabelProducts(rows=>e.target.checked?[...rows,p.id]:rows.filter(id=>id!==p.id))}/><input aria-label="Jumlah label" style={{width:48}} type="number" min="1" max="100" value={labelCopies[p.id]||1} onChange={e=>setLabelCopies(rows=>({...rows,[p.id]:e.target.value}))}/></label></td><td>{p.image_url?<img className="table-product-image" src={p.image_url} alt={p.name}/>:<span className="muted">—</span>}</td><td><b>{p.name}</b></td><td>{p.sku||"—"}</td><td>{p.category}</td><td>{money(p.price)}</td><td>{p.discountType==="percent"?p.discountValue+"%":p.discountType==="fixed"?money(p.discountValue):"—"}</td><td>{Number(p.warranty_months)>0?p.warranty_months+" bln · "+p.warranty_coverage_percent+"%":"—"}</td><td>{p.stock}</td><td><span className={p.stock<=0?"badge red":p.stock<=p.min?"badge yellow":"badge green"}>{p.stock<=0?"Habis":p.stock<=p.min?"Menipis":"Aman"}</span></td><td><button type="button" className="text-btn" onClick={()=>beginEditProduct(p)}>Edit</button></td></tr>)}</tbody></table></div>}{filteredProducts.length===0&&<div className="empty">{products.length===0?"Belum ada produk di database.":"Tidak ada produk yang cocok dengan pencarian atau filter stok."}</div>}</section></>}
        {page==="Pemasok"&&<><div className="welcome"><div><span className="eyebrow">MITRA TOKO</span><h1>Pemasok</h1><p>Kelola data pemasok untuk pencatatan pembelian.</p></div><button className="primary" onClick={()=>setShowSupplierForm(v=>!v)}>＋ Tambah pemasok</button></div>
          {showSupplierForm&&<form className="panel form-grid" onSubmit={saveSupplier}><label>Nama pemasok<input required value={supplierForm.name} onChange={e=>setSupplierForm({...supplierForm,name:e.target.value})}/></label><label>Nomor telepon<input value={supplierForm.phone} onChange={e=>setSupplierForm({...supplierForm,phone:e.target.value})}/></label><label>Email<input type="email" value={supplierForm.email} onChange={e=>setSupplierForm({...supplierForm,email:e.target.value})}/></label><label>Alamat<input value={supplierForm.address} onChange={e=>setSupplierForm({...supplierForm,address:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pemasok</button><button type="button" className="secondary" onClick={()=>setShowSupplierForm(false)}>Batal</button></div></form>}
          <section className="panel"><div className="table-wrap"><table><thead><tr><th>NAMA PEMASOK</th><th>TELEPON</th><th>EMAIL</th><th>ALAMAT</th></tr></thead><tbody>{suppliers.map(s=><tr key={s.id}><td><b>{s.name}</b></td><td>{s.phone||"—"}</td><td>{s.email||"—"}</td><td>{s.address||"—"}</td></tr>)}</tbody></table></div>{suppliers.length===0&&<div className="empty">Belum ada data pemasok.</div>}</section></>}
        {page==="Stok Opname"&&<><div className="welcome"><div><span className="eyebrow">INVENTORY CONTROL</span><h1>Stok Opname</h1><p>Bandingkan stok sistem dengan hasil hitung fisik. Penyesuaian baru berlaku setelah disetujui Owner/Admin.</p></div><button className="secondary" onClick={loadData}>↻ Segarkan</button></div>
          <section className="panel"><div className="panel-head"><div><h3>Hitung stok fisik</h3><p>Daftar produk untuk gudang yang sedang dipilih.</p></div></div>
            <div className="form-grid"><label>Gudang aktif<input readOnly value={warehouses.find(w=>w.id===warehouseId)?.name||"Pilih gudang di bagian atas"}/></label><label>Catatan opname<input value={opnameNotes} maxLength="1000" onChange={e=>setOpnameNotes(e.target.value)} placeholder="Contoh: opname akhir bulan"/></label></div>
            <div className="table-wrap"><table><thead><tr><th>PRODUK</th><th>SKU / BARCODE</th><th>STOK SISTEM</th><th>JUMLAH FISIK</th><th>SELISIH</th></tr></thead><tbody>{products.map(p=>{const val=stockCountDraft[p.id]??String(p.stock);const diff=Number(val||0)-Number(p.stock||0);return <tr key={p.id}><td><b>{p.name}</b><small>{p.category}</small></td><td>{p.sku||"—"}<small>{p.barcode||""}</small></td><td>{p.stock} {p.unit}</td><td><input aria-label={"Jumlah fisik "+p.name} type="number" min="0" step="0.001" value={val} onChange={e=>setStockCountDraft(s=>({...s,[p.id]:e.target.value}))}/></td><td><b className={diff===0?"text-safe":diff<0?"danger-text":"badge yellow"}>{diff>0?"+":""}{diff}</b></td></tr>})}</tbody></table></div>
            {products.length===0&&<div className="empty">Tidak ada produk aktif di bisnis ini.</div>}
            <div className="form-actions"><button className="primary" disabled={busy||!warehouseId||!products.length} onClick={createStockOpname}>Simpan draft stok opname</button></div>
          </section>
          <section className="panel"><div className="panel-head"><div><h3>Riwayat stok opname</h3><p>Draft menunggu persetujuan. Persetujuan akan mengubah stok dan membuat jejak pergerakan persediaan.</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>NOMOR</th><th>TANGGAL</th><th>BARIS PRODUK</th><th>TOTAL SELISIH ABSOLUT</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>{stockOpnames.map(o=><tr key={o.id}><td><b>{o.opname_no}</b><small>{o.notes||""}</small></td><td>{new Date(o.created_at).toLocaleString("id-ID")}</td><td>{o.total_lines}</td><td>{o.total_difference}</td><td><span className={"badge "+(o.status==="approved"?"green":o.status==="draft"?"yellow":"")}>{o.status==="approved"?"Disetujui":o.status==="draft"?"Menunggu persetujuan":"Dibatalkan"}</span></td><td>{o.status==="draft"&&["owner","admin"].includes(membership?.role)?<button className="primary small" disabled={busy} onClick={()=>approveStockOpname(o)}>Setujui</button>:"—"}</td></tr>)}</tbody></table></div>{stockOpnames.length===0&&<div className="empty">Belum ada riwayat stok opname.</div>}
          </section>
        </>}
        {page==="Transfer Stok"&&<><div className="welcome"><div><span className="eyebrow">MULTI-BRANCH INVENTORY</span><h1>Transfer Stok</h1><p>Pindahkan persediaan antar gudang dalam bisnis yang sama dengan persetujuan dan audit.</p></div><button className="secondary" onClick={loadData}>↻ Segarkan</button></div>
          <section className="panel"><div className="panel-head"><div><h3>Buat permintaan transfer</h3><p>Gudang asal mengikuti pilihan gudang aktif. Persediaan baru berpindah setelah disetujui.</p></div></div>
            <div className="form-grid"><label>Gudang asal<input readOnly value={warehouses.find(w=>w.id===warehouseId)?.name||"Pilih gudang aktif di bagian atas"}/></label>
              <label>Gudang tujuan<select value={transferDestination} onChange={e=>setTransferDestination(e.target.value)}><option value="">Pilih gudang tujuan</option>{warehouses.filter(w=>w.id!==warehouseId).map(w=><option key={w.id} value={w.id}>{w.name} · {branches.find(b=>b.id===w.branch_id)?.name||"Cabang"}</option>)}</select></label>
              <label>Produk<select value={transferProduct} onChange={e=>setTransferProduct(e.target.value)}><option value="">Pilih produk</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} · Stok sumber: {p.stock}</option>)}</select></label>
              <label>Jumlah<input type="number" min="0.001" step="0.001" value={transferQuantity} onChange={e=>setTransferQuantity(e.target.value)}/></label>
              <label>Catatan<input value={transferNotes} maxLength="1000" onChange={e=>setTransferNotes(e.target.value)} placeholder="Alasan pemindahan stok"/></label>
            </div>
            <div className="form-actions"><button className="primary" disabled={busy||!transferDestination||!transferProduct||!warehouseId} onClick={createStockTransfer}>Buat permintaan transfer</button></div>
          </section>
          <section className="panel"><div className="panel-head"><div><h3>Riwayat transfer</h3><p>Stok sumber akan divalidasi kembali saat persetujuan untuk mencegah stok minus.</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>NOMOR</th><th>ASAL</th><th>TUJUAN</th><th>BARIS</th><th>TANGGAL</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>{stockTransfers.map(t=><tr key={t.id}><td><b>{t.transfer_no}</b><small>{t.notes||""}</small></td><td>{warehouses.find(w=>w.id===t.from_warehouse_id)?.name||t.from_warehouse_id.slice(0,8)}</td><td>{warehouses.find(w=>w.id===t.to_warehouse_id)?.name||t.to_warehouse_id.slice(0,8)}</td><td>{t.total_lines}</td><td>{new Date(t.created_at).toLocaleString("id-ID")}</td><td><span className={"badge "+(t.status==="approved"?"green":"yellow")}>{t.status==="approved"?"Disetujui":t.status==="draft"?"Menunggu":"Dibatalkan"}</span></td><td>{t.status==="draft"&&["owner","admin","manager"].includes(membership?.role)?<button className="primary small" disabled={busy} onClick={()=>approveStockTransfer(t)}>Setujui</button>:"—"}</td></tr>)}</tbody></table></div>{stockTransfers.length===0&&<div className="empty">Belum ada permintaan transfer.</div>}
          </section>
        </>}
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
        {page==="Retur Pembelian"&&<><div className="welcome"><div><span className="eyebrow">SUPPLIER MANAGEMENT</span><h1>Retur Pembelian</h1><p>Catat barang yang dikembalikan kepada supplier dari pembelian yang sudah diterima.</p></div></div>
          <section className="panel"><div className="panel-head"><div><h3>Buat retur supplier</h3><p>Pilih pembelian dan jumlah barang. Sistem membatasi jumlah retur agar tidak melebihi kuantitas pembelian.</p></div></div>
            <form className="form-grid" onSubmit={createSupplierReturn}>
              <label>Pembelian diterima<select required value={supplierReturnDraft.purchase_id} onChange={e=>{setSupplierReturnDraft({...supplierReturnDraft,purchase_id:e.target.value});setSupplierReturnQuantities({});}}><option value="">Pilih nomor pembelian</option>{purchases.filter(p=>p.status==="received").map(p=><option key={p.id} value={p.id}>{p.purchase_no} · {p.suppliers?.name||"Supplier"} · {money(p.total)}</option>)}</select></label>
              <label>Alasan retur<input required maxLength="500" value={supplierReturnDraft.reason} onChange={e=>setSupplierReturnDraft({...supplierReturnDraft,reason:e.target.value})} placeholder="Contoh: barang cacat atau salah kirim"/></label>
              <label>Catatan tambahan<input maxLength="1000" value={supplierReturnDraft.notes} onChange={e=>setSupplierReturnDraft({...supplierReturnDraft,notes:e.target.value})}/></label>
              {(()=>{const selected=purchases.find(p=>p.id===supplierReturnDraft.purchase_id);return selected?<div className="table-wrap" style={{gridColumn:"1 / -1"}}><table><thead><tr><th>PRODUK</th><th>QTY DITERIMA</th><th>HARGA MODAL</th><th>QTY RETUR</th></tr></thead><tbody>{(selected.purchase_items||[]).map(item=><tr key={item.id}><td>{products.find(p=>p.id===item.product_id)?.name||"Produk"}</td><td>{item.quantity}</td><td>{money(item.unit_cost)}</td><td><input aria-label="Jumlah retur" type="number" min="0" max={item.quantity} step="0.01" style={{maxWidth:110}} value={supplierReturnQuantities[item.id]||""} onChange={e=>setSupplierReturnQuantities(v=>({...v,[item.id]:e.target.value}))}/></td></tr>)}</tbody></table></div>:<div className="notice" style={{gridColumn:"1 / -1"}}>Pilih pembelian berstatus diterima untuk menampilkan rincian barang.</div>})()}
              <div className="form-actions"><button className="primary" disabled={busy||!supplierReturnDraft.purchase_id}>Buat draft retur</button></div>
            </form>
            <div className="notice">Persetujuan retur akan mengurangi stok gudang dan mencatat pergerakan stok. Nilai retur belum otomatis mengurangi saldo hutang supplier; integrasi nota kredit supplier masih menjadi pekerjaan lanjutan.</div>
          </section>
          <section className="panel"><div className="panel-head"><div><h3>Riwayat retur supplier</h3><p>Retur draft, disetujui, dan dibatalkan.</p></div></div><div className="table-wrap"><table><thead><tr><th>TANGGAL</th><th>NO. RETUR</th><th>PEMBELIAN</th><th>SUPPLIER</th><th>NILAI</th><th>STATUS</th><th>ALASAN</th><th>AKSI</th></tr></thead><tbody>{supplierReturns.map(row=><tr key={row.id}><td>{new Date(row.created_at).toLocaleString("id-ID")}</td><td><b>{row.return_no}</b></td><td>{row.purchase_orders?.purchase_no||"—"}</td><td>{row.suppliers?.name||"—"}</td><td>{money(row.total)}</td><td><span className={"badge "+(row.status==="approved"?"green":row.status==="draft"?"yellow":"red")}>{row.status==="approved"?"Disetujui":row.status==="draft"?"Draft":"Dibatalkan"}</span></td><td>{row.reason}</td><td>{row.status==="draft"?<div className="action-group">{["owner","admin"].includes(membership?.role)&&<button className="primary small" disabled={busy} onClick={()=>approveSupplierReturn(row)}>Setujui</button>}<button className="secondary small" disabled={busy||!["owner","admin"].includes(membership?.role)} onClick={()=>cancelSupplierReturn(row)}>Batalkan</button></div>:"—"}</td></tr>)}</tbody></table></div>{supplierReturns.length===0&&<div className="empty">Belum ada retur pembelian.</div>}</section>
        </>}
        {page==="Pelanggan"&&<><div className="welcome"><div><span className="eyebrow">CRM</span><h1>Pelanggan</h1><p>Data pelanggan tersimpan di cloud.</p></div><button className="primary" onClick={()=>setShowCustomerForm(v=>!v)}>＋ Tambah pelanggan</button></div>
          {showCustomerForm&&<form className="panel form-grid" onSubmit={saveCustomer}><label>Nama pelanggan<input required value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/></label><label>Nomor telepon<input value={customerForm.phone} onChange={e=>setCustomerForm({...customerForm,phone:e.target.value})}/></label><label>Email<input type="email" value={customerForm.email} onChange={e=>setCustomerForm({...customerForm,email:e.target.value})}/></label><label>Alamat<input value={customerForm.address} onChange={e=>setCustomerForm({...customerForm,address:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pelanggan</button></div></form>}
          <section className="panel"><div className="table-wrap"><table><thead><tr><th>ID BARCODE</th><th>NAMA</th><th>MEMBER</th><th>TOTAL BELANJA</th><th>TRANSAKSI</th><th>TELEPON</th></tr></thead><tbody>{customers.map(c=><tr key={c.id}><td><CustomerBarcode customer={c}/></td><td><b>{c.name}</b></td><td><span className={"badge "+(c.membership_tier==="platinum"?"purple":c.membership_tier==="gold"?"yellow":"green")}>{(c.membership_tier||"silver").toUpperCase()}</span></td><td>{money(c.total_spend)}</td><td>{c.total_transactions||0}</td><td>{c.phone||"—"}</td></tr>)}</tbody></table></div>{customers.length===0&&<div className="empty">Belum ada data pelanggan.</div>}</section></>}
        {page==="Loyalty Point"&&<><div className="welcome"><div><span className="eyebrow">CUSTOMER LOYALTY</span><h1>Loyalty Point</h1><p>Saldo poin pelanggan, aturan perolehan, penukaran hadiah, dan riwayat aktivitas.</p></div></div>
          <div className="stats">{card("Pelanggan memiliki poin",new Set(loyaltyLedger.filter(x=>x.points_delta>0).map(x=>x.customer_id)).size,"Berdasarkan ledger yang tercatat","♙")}{card("Poin diperoleh",loyaltyLedger.filter(x=>x.event_type==="earn"||x.event_type==="adjustment").reduce((n,x)=>n+Number(x.points_delta),0),"Perolehan dan penyesuaian positif","★")}{card("Poin ditukarkan",Math.abs(loyaltyLedger.filter(x=>x.event_type==="redeem").reduce((n,x)=>n+Number(x.points_delta),0)),"Hadiah yang telah diberikan","↗")}{card("Poin dibatalkan",Math.abs(loyaltyLedger.filter(x=>x.event_type==="reversal").reduce((n,x)=>n+Number(x.points_delta),0)),"Akibat retur penjualan","↩")}</div>
          <section className="panel"><div className="panel-head"><div><h3>Saldo poin pelanggan</h3><p>Saldo dihitung dari seluruh mutasi poin, bukan angka yang bisa diedit langsung.</p></div></div><div className="table-wrap"><table><thead><tr><th>PELANGGAN</th><th>MEMBER</th><th>TRANSAKSI</th><th>POIN DIPEROLEH</th><th>POIN DITUKAR</th><th>POIN RETUR</th><th>SALDO</th></tr></thead><tbody>{customers.map(c=>{const rows=loyaltyLedger.filter(x=>x.customer_id===c.id);const earned=rows.filter(x=>x.event_type==="earn"||x.event_type==="adjustment").reduce((n,x)=>n+Number(x.points_delta),0);const redeemed=Math.abs(rows.filter(x=>x.event_type==="redeem").reduce((n,x)=>n+Number(x.points_delta),0));const reversed=Math.abs(rows.filter(x=>x.event_type==="reversal").reduce((n,x)=>n+Number(x.points_delta),0));return <tr key={c.id}><td><b>{c.name}</b><small style={{display:"block"}}>{c.phone||c.customer_code||"—"}</small></td><td>{(c.membership_tier||"silver").toUpperCase()}</td><td>{c.total_transactions||0}</td><td>{earned.toLocaleString("id-ID")}</td><td>{redeemed.toLocaleString("id-ID")}</td><td>{reversed.toLocaleString("id-ID")}</td><td><b>{(earned-redeemed-reversed).toLocaleString("id-ID")}</b></td></tr>})}</tbody></table></div>{customers.length===0&&<div className="empty">Belum ada pelanggan.</div>}</section>
          <section className="panel"><div className="panel-head"><div><h3>Catat penukaran poin</h3><p>Untuk penukaran hadiah fisik/manual. Kasir wajib menyerahkan hadiah sebelum mengonfirmasi pencatatan.</p></div></div><form className="form-grid" onSubmit={redeemLoyaltyPoints}><label>Pelanggan<select required value={loyaltyRedeemDraft.customer_id} onChange={e=>setLoyaltyRedeemDraft({...loyaltyRedeemDraft,customer_id:e.target.value})}><option value="">Pilih pelanggan</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.customer_code||c.phone||c.id.slice(0,8)}</option>)}</select></label><label>Jumlah poin<input required type="number" min={loyaltyProgram?.minimum_redeem_points||1} step="1" value={loyaltyRedeemDraft.points} onChange={e=>setLoyaltyRedeemDraft({...loyaltyRedeemDraft,points:e.target.value})}/></label><label>Hadiah/keterangan<input required maxLength="500" value={loyaltyRedeemDraft.description} onChange={e=>setLoyaltyRedeemDraft({...loyaltyRedeemDraft,description:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy||!loyaltyProgram?.is_enabled}>Catat penukaran hadiah</button></div></form>{!loyaltyProgram?.is_enabled&&<p className="warning-note">Aktifkan program dan tetapkan aturan di menu Pengaturan sebelum penukaran.</p>}</section>
          <section className="panel"><div className="panel-head"><div><h3>Riwayat mutasi poin</h3><p>1000 mutasi terbaru dari seluruh cabang yang dapat diakses.</p></div></div><div className="table-wrap"><table><thead><tr><th>WAKTU</th><th>PELANGGAN</th><th>JENIS</th><th>POIN</th><th>KETERANGAN</th><th>REFERENSI</th></tr></thead><tbody>{loyaltyLedger.map(x=><tr key={x.id}><td>{new Date(x.created_at).toLocaleString("id-ID")}</td><td>{customers.find(c=>c.id===x.customer_id)?.name||"Pelanggan"}</td><td>{({earn:"Perolehan",redeem:"Penukaran",adjustment:"Penyesuaian",reversal:"Pembatalan retur"})[x.event_type]||x.event_type}</td><td className={x.points_delta>0?"text-safe":"danger-text"}>{x.points_delta>0?"+":""}{x.points_delta}</td><td>{x.description||"—"}</td><td>{x.reference_type}</td></tr>)}</tbody></table></div>{loyaltyLedger.length===0&&<div className="empty">Belum ada mutasi poin. Poin akan mulai tercatat setelah program diaktifkan dan transaksi lunas berikutnya terjadi.</div>}</section>
        </>}
        {page==="Laporan"&&<><div className="welcome"><div><span className="eyebrow">ANALITIK & KEUANGAN</span><h1>Laporan Lengkap</h1><p>Analisis penjualan, transaksi, produk, kategori, pembayaran, dan laba-rugi.</p></div><div className="action-group"><select aria-label="Periode laporan" value={reportPeriod} onChange={e=>setReportPeriod(e.target.value)}><option value="today">Hari ini</option><option value="yesterday">Kemarin</option><option value="week">Minggu ini</option><option value="month">Bulan ini</option><option value="year">Tahun ini</option><option value="7">7 hari terakhir</option><option value="30">30 hari terakhir</option><option value="90">90 hari terakhir</option><option value="custom">Rentang khusus</option><option value="all">Semua data termuat</option></select>{reportPeriod==="custom"&&<><label className="report-date">Dari<input type="date" value={reportStartDate} onChange={e=>setReportStartDate(e.target.value)}/></label><label className="report-date">Sampai<input type="date" value={reportEndDate} onChange={e=>setReportEndDate(e.target.value)}/></label></>}<button className="secondary" onClick={()=>{const rows=[["Invoice","Status","Tanggal","Jumlah item","Metode pembayaran","Total"],...reportTransactions.map(x=>[x.invoice_no,x.status,x.created_at,(x.sale_items||[]).reduce((n,i)=>n+Number(i.quantity||0),0),(x.sale_payments||[]).map(p=>p.payment_method).join(" + "),x.total])];const csv=rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.download="laporan-transaksi-smart-pos.csv";a.click();URL.revokeObjectURL(a.href);}}>↓ Ekspor transaksi CSV</button></div></div>
          <div className="report-filter-row"><label>Staff<select value={reportStaffFilter} onChange={e=>setReportStaffFilter(e.target.value)}><option value="all">Semua staff</option>{staffMembers.map(m=><option key={m.user_id} value={m.user_id}>{m.profile?.full_name||m.profile?.employee_code||m.user_id.slice(0,8)}</option>)}</select></label><label>Metode bayar<select value={reportPaymentFilter} onChange={e=>setReportPaymentFilter(e.target.value)}><option value="all">Semua metode</option>{reportPaymentOptions.map(x=><option key={x}>{x}</option>)}</select></label><label>Kategori<select value={reportCategoryFilter} onChange={e=>setReportCategoryFilter(e.target.value)}><option value="all">Semua kategori</option>{reportCategoryOptions.map(x=><option key={x}>{x}</option>)}</select></label></div>
          <div className="stats">{card("Transaksi",reportTransactions.length,"Semua status · data termuat" ,"▣")}{card("Transaksi lunas",reportSales.length,"Periode terpilih","✓")}{card("Omzet lunas",money(profitLoss?.revenue??reportRevenue),"Total penjualan bersih","↗")}{card("Rata-rata transaksi",money(reportSales.length?reportRevenue/reportSales.length:0),"Nilai rata-rata lunas","◷")}</div>
          <section className="panel"><div className="panel-head"><div><h3>Grafik penjualan harian</h3><p>Omzet transaksi lunas per hari · zona waktu WIB.</p></div><span className="badge green">Grafik omzet</span></div>
            {reportDaily.every(x=>x.revenue===0)?<div className="empty">Belum ada penjualan lunas pada periode ini.</div>:<div className="chart-scroll"><div className="chart-bars">{reportDaily.map(row=><div className="chart-column" key={row.key} title={row.key+" · "+money(row.revenue)}><strong>{row.revenue?money(row.revenue):"—"}</strong><div className="chart-bar-track"><span style={{height:Math.max(3,reportDaily.length?row.revenue/Math.max(...reportDaily.map(x=>x.revenue),1)*100:0)+"%"}}/></div><small>{row.label}</small></div>)}</div></div>}
          </section>
          <div className="grid-two"><section className="panel"><div className="panel-head"><div><h3>Laporan laba rugi</h3><p>HPP memakai snapshot modal saat transaksi. Pembayaran hutang supplier tidak dihitung sebagai beban operasional.</p></div><span className="badge">{profitLossLoading?"Memuat...":"Cabang aktif"}</span></div>
            <div className="stats">{card("Penjualan bersih",money(profitLoss?.revenue||0),"Transaksi berstatus lunas","↗")}{card("HPP",Number(profitLoss?.missing_cost_items||0)>0?"Belum lengkap":money(profitLoss?.hpp||0),"Harga pokok barang terjual","▤")}{card("Laba kotor",profitLoss?.gross_profit==null?"Belum dapat dihitung":money(profitLoss.gross_profit),"Penjualan bersih − HPP","＋")}{card("Komisi penjualan",money(profitLoss?.commission_expenses||0),"Beban saat produk terjual","Rp")}{card("Beban operasional",money(profitLoss?.operating_expenses||0),"Di luar komisi dan pembayaran supplier","↘")}{card("Pendapatan lain",money(profitLoss?.other_income||0),"Kategori Pendapatan lain","＋")}{card("Laba bersih",profitLoss?.net_profit==null?"Belum dapat dihitung":money(profitLoss.net_profit),"Laba kotor − komisi − beban + pendapatan lain","＝")}</div>
            {Number(profitLoss?.missing_cost_items||0)>0&&<div className="notice warning-note">Ada {profitLoss.missing_cost_items} item dari {profitLoss.missing_cost_sales} transaksi lama yang belum memiliki snapshot modal. Laba historis tersebut tidak dihitung agar tidak menyesatkan.</div>}
          </section>
          <section className="panel"><div className="panel-head"><div><h3>Metode pembayaran</h3><p>Total nominal pembayaran untuk transaksi lunas.</p></div></div>
            {reportPaymentMethods.length===0?<div className="empty">Belum ada data pembayaran.</div>:<div className="report-breakdown">{reportPaymentMethods.map(x=><div className="breakdown-row" key={x.name}><div><b>{x.name}</b><strong>{money(x.amount)}</strong></div><div className="breakdown-track"><span style={{width:(reportPaymentMethods.length?x.amount/Math.max(...reportPaymentMethods.map(y=>y.amount),1)*100:0)+"%"}}/></div></div>)}</div>}
          </section></div>
          <div className="grid-two"><section className="panel"><div className="panel-head"><div><h3>Penjualan per kategori</h3><p>Kontribusi omzet menurut kategori.</p></div></div>{reportCategories.length===0?<div className="empty">Belum ada data pada periode ini.</div>:<div className="table-wrap"><table><thead><tr><th>KATEGORI</th><th>UNIT</th><th>OMZET</th><th>KONTRIBUSI</th></tr></thead><tbody>{reportCategories.map(row=><tr key={row.name}><td><b>{row.name}</b></td><td>{row.quantity}</td><td className="amount">{money(row.revenue)}</td><td>{reportRevenue?Math.round(row.revenue/reportRevenue*100):0}%</td></tr>)}</tbody></table></div>}</section>
          <section className="panel"><div className="panel-head"><div><h3>Produk terlaris</h3><p>Diurutkan dari omzet terbesar.</p></div></div>{reportItems.length===0?<div className="empty">Belum ada produk terjual.</div>:<div className="table-wrap"><table><thead><tr><th>PRODUK</th><th>UNIT</th><th>OMZET</th></tr></thead><tbody>{reportItems.slice(0,10).map(row=><tr key={row.name+row.category}><td><b>{row.name}</b><small>{row.category}</small></td><td>{row.quantity}</td><td className="amount">{money(row.revenue)}</td></tr>)}</tbody></table></div>}</section></div>
          <div className="stats">{card("Nilai modal stok",money(inventoryValuation),"Persediaan semua gudang cabang aktif","▤")}{card("Member baru",reportMemberMetrics.newMembers,"Bergabung pada periode terpilih","♙")}{card("Member Silver",reportMemberMetrics.silver,"Database pelanggan","S")}{card("Member Gold / Platinum",reportMemberMetrics.gold+" / "+reportMemberMetrics.platinum,"Database pelanggan","★")}</div>
          <div className="grid-two"><section className="panel"><div className="panel-head"><div><h3>Laporan pembelian supplier</h3><p>{reportPurchases.length} pembelian pada periode · daftar terbaru yang termuat.</p></div></div>
            {reportPurchases.length===0?<div className="empty">Tidak ada pembelian pada periode ini.</div>:<div className="table-wrap"><table><thead><tr><th>NOMOR</th><th>TANGGAL</th><th>SUPPLIER</th><th>ITEM</th><th>TOTAL</th><th>SISA HUTANG</th></tr></thead><tbody>{reportPurchases.map(p=><tr key={p.id}><td>{p.purchase_no}</td><td>{new Date(p.created_at).toLocaleDateString("id-ID")}</td><td>{p.suppliers?.name||"—"}</td><td>{(p.purchase_items||[]).reduce((n,i)=>n+Number(i.quantity||0),0)}</td><td>{money(p.total)}</td><td>{p.payable_tracking_enabled?money(Math.max(0,Number(p.total||0)-Number(p.amount_paid||0))):"—"}</td></tr>)}</tbody></table></div>}
          </section><section className="panel"><div className="panel-head"><div><h3>Komisi per staff</h3><p>Akumulasi ledger komisi cabang aktif.</p></div></div>
            {reportCommissionByStaff.length===0?<div className="empty">Belum ada data komisi.</div>:<div className="table-wrap"><table><thead><tr><th>STAFF</th><th>TERTUNDA</th><th>DIBAYAR</th><th>TOTAL</th></tr></thead><tbody>{reportCommissionByStaff.map(x=><tr key={x.user_id}><td>{staffMembers.find(m=>m.user_id===x.user_id)?.profile?.full_name||x.user_id.slice(0,8)+"…"}</td><td>{money(x.pending)}</td><td>{money(x.paid)}</td><td className="amount">{money(x.total)}</td></tr>)}</tbody></table></div>}
          </section></div>
          <section className="panel"><div className="panel-head"><div><h3>Arus kas tercatat</h3><p>Ringkasan catatan kas pada periode terpilih · maksimal 200 catatan terbaru.</p></div></div>
            <div className="stats">{card("Uang masuk",money(reportCashEntries.filter(x=>x.entry_type==="income").reduce((n,x)=>n+Number(x.amount||0),0)),"Catatan kas masuk","↗")}{card("Uang keluar",money(reportCashEntries.filter(x=>x.entry_type==="expense").reduce((n,x)=>n+Number(x.amount||0),0)),"Catatan kas keluar","↘")}{card("Arus kas bersih",money(reportCashEntries.reduce((n,x)=>n+(x.entry_type==="income"?1:-1)*Number(x.amount||0),0)),"Masuk dikurangi keluar","⇄")}</div>
          </section>
          <section className="panel"><div className="panel-head"><div><h3>Daftar transaksi</h3><p>{filteredReportTransactions.length} transaksi ditemukan · maksimum 1.000 transaksi terbaru dimuat.</p></div><input className="report-search" value={reportSearch} onChange={e=>setReportSearch(e.target.value)} placeholder="Cari nomor invoice / status..."/></div>
            <div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>TANGGAL</th><th>STATUS</th><th>JUMLAH ITEM</th><th>METODE BAYAR</th><th>TOTAL</th></tr></thead><tbody>{filteredReportTransactions.map(row=><tr key={row.id}><td><b>{row.invoice_no}</b></td><td>{new Date(row.created_at).toLocaleString("id-ID")}</td><td><span className={"badge "+(row.status==="paid"?"green":row.status==="cancelled"?"red":"yellow")}>{row.status==="paid"?"LUNAS":row.status==="cancelled"?"DIBATALKAN":String(row.status||"").toUpperCase()}</span></td><td>{(row.sale_items||[]).reduce((n,item)=>n+Number(item.quantity||0),0)}</td><td>{(row.sale_payments||[]).map(p=>p.payment_method).filter(Boolean).join(", ")||"—"}</td><td className="amount">{money(row.total)}</td></tr>)}</tbody></table></div>
            {filteredReportTransactions.length===0&&<div className="empty">Tidak ada transaksi yang cocok dengan pencarian.</div>}
          </section></>}
        {page==="Keuangan"&&<><div className="welcome"><div><span className="eyebrow">FINANCIAL MANAGEMENT</span><h1>Keuangan</h1><p>Ringkasan uang masuk dan pengeluaran yang tercatat di database untuk cabang aktif.</p></div></div>
          <div className="stats">{card("Uang masuk",money(cashEntries.filter(x=>x.entry_type==="income").reduce((a,x)=>a+Number(x.amount),0)),"Maks. 200 catatan terbaru","↗")}{card("Pengeluaran",money(cashEntries.filter(x=>x.entry_type==="expense").reduce((a,x)=>a+Number(x.amount),0)),"Maks. 200 catatan terbaru","↘")}{card("Arus kas bersih",money(cashEntries.reduce((a,x)=>a+(x.entry_type==="income"?1:-1)*Number(x.amount),0)),"Masuk dikurangi keluar","⇄")}{card("Catatan kas",cashEntries.length+" transaksi","Cabang aktif","▤")}</div>
          {["owner","admin","manager"].includes(membership?.role)&&<form className="panel form-grid" onSubmit={saveExpense}><div><h3>Catat pengeluaran</h3><p className="muted">Hanya Owner, Admin, dan Manager yang dapat menyimpan pengeluaran.</p></div><label>Kategori<select value={expenseForm.category} onChange={e=>setExpenseForm({...expenseForm,category:e.target.value})}><option>Operasional</option><option>Transportasi</option><option>Listrik & Air</option><option>Gaji</option><option>Pemasaran</option><option>Perawatan</option><option>Lainnya</option></select></label><label>Keterangan<input required maxLength="500" value={expenseForm.description} onChange={e=>setExpenseForm({...expenseForm,description:e.target.value})} placeholder="Contoh: pembelian perlengkapan toko"/></label><label>Nominal (Rp)<input required type="number" min="1" step="1" value={expenseForm.amount} onChange={e=>setExpenseForm({...expenseForm,amount:e.target.value})} placeholder="100000"/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan pengeluaran</button></div></form>}
          <section className="panel"><div className="panel-head"><div><h3>Riwayat kas</h3><p>Uang masuk dari transaksi dan pengeluaran manual</p></div><button className="secondary" onClick={loadData}>↻ Segarkan</button></div><div className="table-wrap"><table><thead><tr><th>TANGGAL</th><th>JENIS</th><th>KATEGORI</th><th>KETERANGAN</th><th>NOMINAL</th></tr></thead><tbody>{cashEntries.map(x=><tr key={x.id}><td>{new Date(x.created_at).toLocaleString("id-ID")}</td><td><span className={x.entry_type==="income"?"badge green":"badge red"}>{x.entry_type==="income"?"Masuk":"Keluar"}</span></td><td>{x.category}</td><td>{x.description}</td><td className="amount">{money(x.amount)}</td></tr>)}</tbody></table></div>{cashEntries.length===0&&<div className="empty">Belum ada catatan kas untuk cabang ini.</div>}</section>
          <p className="warning-note">Catatan: ringkasan ini memakai maksimal 200 catatan terbaru. Pembelian barang yang diterima belum otomatis menjadi pengeluaran kas karena pembayaran pemasok/hutang belum dibangun. Laba-rugi akuntansi belum ditampilkan pada tahap ini.</p></>}
        {page==="Karyawan & Shift"&&<><div className="welcome"><div><span className="eyebrow">PEOPLE & CASH CONTROL</span><h1>Karyawan, Absensi & Shift</h1><p>Kelola profil akun yang sudah bergabung, cabang kerja, peran, absensi, dan rekonsiliasi kasir.</p></div><button className="secondary" onClick={loadData}>↻ Segarkan</button></div>
          {["owner","admin"].includes(membership?.role)?<section className="panel">
            <div className="panel-head"><div><h3>Manajemen karyawan & perangkat</h3><p>Buat akun tanpa email pribadi. Karyawan masuk menggunakan kode dan PIN 6 angka.</p></div><div className="action-group"><button type="button" className="secondary" disabled={busy||!branchId} onClick={pairCurrentDevice}>Pasangkan perangkat ini</button><button type="button" className="secondary" disabled={busy} onClick={revokeCurrentDevice}>Cabut akses perangkat ini</button></div></div>
            <form className="form-grid" onSubmit={createStaffAccount}>
              <label>Kode karyawan<input required maxLength="32" value={staffDraft.employee_code} onChange={e=>setStaffDraft({...staffDraft,employee_code:e.target.value.toUpperCase()})} placeholder="Contoh: KRY001"/></label>
              <label>Nama lengkap<input required maxLength="120" value={staffDraft.full_name} onChange={e=>setStaffDraft({...staffDraft,full_name:e.target.value})} placeholder="Nama karyawan"/></label>
              <label>Nomor telepon<input maxLength="30" value={staffDraft.phone} onChange={e=>setStaffDraft({...staffDraft,phone:e.target.value})}/></label>
              <label>Jabatan<input maxLength="80" value={staffDraft.job_title} onChange={e=>setStaffDraft({...staffDraft,job_title:e.target.value})} placeholder="Kasir / Gudang"/></label>
              <label>Cabang<select required value={staffDraft.branch_id||branchId} onChange={e=>setStaffDraft({...staffDraft,branch_id:e.target.value})}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label>Peran akses<select value={staffDraft.role} onChange={e=>setStaffDraft({...staffDraft,role:e.target.value})}><option value="cashier">Kasir</option><option value="staff">Staf</option><option value="manager">Manager</option></select></label>
              <label>Jenis komisi<select value={staffDraft.commission_type} onChange={e=>setStaffDraft({...staffDraft,commission_type:e.target.value})}><option value="percent">Persentase omzet bersih</option><option value="per_unit">Nominal per unit</option><option value="none">Tanpa komisi</option></select></label>
              <label>Nilai komisi<input type="number" min="0" step="0.01" value={staffDraft.commission_value} onChange={e=>setStaffDraft({...staffDraft,commission_value:e.target.value})} disabled={staffDraft.commission_type==="none"}/></label>
              <label>PIN awal (6 angka)<input required type="password" inputMode="numeric" maxLength="6" pattern="[0-9]{6}" value={staffDraft.pin} onChange={e=>setStaffDraft({...staffDraft,pin:e.target.value.replace(/\D/g,"").slice(0,6)})} placeholder="Buat PIN karyawan"/></label>
              <div className="form-actions"><button className="primary" disabled={busy||staffDraft.pin.length!==6}>Buat akun karyawan</button><button type="button" className="secondary" onClick={()=>setStaffDraft({employee_code:"",full_name:"",phone:"",job_title:"",branch_id:branchId,role:"cashier",commission_type:"percent",commission_value:"0",pin:""})}>Kosongkan</button></div>
            </form>
            <div className="table-wrap"><table><thead><tr><th>KODE</th><th>NAMA</th><th>JABATAN</th><th>CABANG</th><th>PERAN</th><th>KOMISI</th><th>STATUS</th><th>PIN</th><th>AKSI</th></tr></thead><tbody>{staffMembers.filter(m=>m.role!=="owner").map(m=><tr key={m.user_id}><td>{m.profile?.employee_code||"—"}</td><td>{m.profile?.full_name||"Akun "+m.user_id.slice(0,8)+"…"}</td><td>{m.profile?.job_title||"—"}</td><td>{branches.find(b=>b.id===m.branch_id)?.name||"—"}</td><td>{m.role}</td><td>{m.profile?.commission_type==="percent"?(Number(m.profile.commission_value)||0)+"%":m.profile?.commission_type==="per_unit"?money(m.profile.commission_value)+"/unit":"Tidak ada"}</td><td><span className={"badge "+(m.is_active?"green":"red")}>{m.is_active?"Aktif":"Nonaktif"}</span></td><td>{m.profile?.id?<button type="button" className="text-btn" disabled={busy} onClick={()=>resetStaffPin(m.profile.id,m.profile.full_name||"karyawan")}>Atur PIN</button>:"Belum ada profil"}</td><td>{m.profile?.id?<button type="button" className="text-btn" disabled={busy} onClick={()=>toggleStaffActive(m)}>{m.is_active?"Nonaktifkan":"Aktifkan"}</button>:"—"}</td></tr>)}</tbody></table></div>
            {staffMembers.filter(m=>m.role!=="owner").length===0&&<div className="empty">Belum ada karyawan. Buat akun pertama menggunakan formulir di atas.</div>}
          </section>:<div className="panel"><div className="notice">Pengelolaan karyawan dan perangkat hanya tersedia untuk Owner/Admin.</div></div>}
          {["owner","admin","manager"].includes(membership?.role)&&<section className="panel"><div className="panel-head"><div><h3>Komisi karyawan</h3><p>Komisi dibuat otomatis saat transaksi berubah menjadi lunas. Dasar hitung dialokasikan proporsional setelah diskon transaksi.</p></div></div><div className="stats">{card("Komisi tertunda",money(commissionLedger.filter(x=>x.status==="pending").reduce((s,x)=>s+Number(x.commission_amount),0)),"Belum dibayar","Rp")}{card("Sudah dibayar",money(commissionLedger.filter(x=>x.status==="paid").reduce((s,x)=>s+Number(x.commission_amount),0)),"Riwayat ledger","✓")}{card("Baris komisi",commissionLedger.length,"Maks. 500 catatan","▤")}</div>{(()=>{const pendingByStaff=Object.values(commissionLedger.filter(x=>x.status==="pending"&&x.branch_id===branchId).reduce((acc,x)=>{const k=x.staff_user_id;acc[k]??={user_id:k,amount:0,count:0};acc[k].amount+=Number(x.commission_amount)||0;acc[k].count+=1;return acc;},{}));return pendingByStaff.length>0?<div className="table-wrap"><table><thead><tr><th>KARYAWAN</th><th>ITEM TERTUNDA</th><th>TOTAL KOMISI</th><th>AKSI</th></tr></thead><tbody>{pendingByStaff.map(x=>{const name=staffMembers.find(m=>m.user_id===x.user_id)?.profile?.full_name||("Akun "+x.user_id.slice(0,8)+"…");return <tr key={x.user_id}><td>{name}</td><td>{x.count}</td><td className="amount">{money(x.amount)}</td><td><button className="primary small" disabled={busy} onClick={()=>payStaffCommission(x.user_id,name,x.amount)}>Bayar komisi</button></td></tr>;})}</tbody></table></div>:<div className="notice">Tidak ada komisi tertunda untuk cabang yang sedang dipilih.</div>;})()}<div className="table-wrap"><table><thead><tr><th>TANGGAL</th><th>STAFF</th><th>PRODUK</th><th>QTY</th><th>DASAR KOMISI</th><th>KOMISI</th><th>STATUS</th></tr></thead><tbody>{commissionLedger.map(x=><tr key={x.id}><td>{new Date(x.created_at).toLocaleString("id-ID")}</td><td>{staffMembers.find(m=>m.user_id===x.staff_user_id)?.profile?.full_name||x.staff_user_id.slice(0,8)+"…"}</td><td>{x.product_name}</td><td>{x.quantity}</td><td>{money(x.commission_base)}</td><td className="amount">{money(x.commission_amount)}</td><td><span className={"badge "+(x.status==="paid"?"green":"yellow")}>{x.status==="paid"?"Dibayar":"Tertunda"}</span></td></tr>)}</tbody></table></div>{commissionLedger.length===0&&<div className="empty">Belum ada komisi. Komisi akan tercatat untuk transaksi lunas karyawan yang memiliki profil komisi aktif.</div>}</section>}
          {["owner","admin"].includes(membership?.role)&&<section className="panel"><div className="panel-head"><div><h3>Aturan komisi khusus produk</h3><p>Aturan produk mengesampingkan komisi dasar karyawan. Cabang dan produk dapat dikosongkan untuk aturan umum.</p></div></div><form className="form-grid" onSubmit={saveCommissionRule}><label>Cabang<select value={commissionRuleDraft.branch_id} onChange={e=>setCommissionRuleDraft({...commissionRuleDraft,branch_id:e.target.value})}><option value="">Semua cabang</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Produk<select value={commissionRuleDraft.product_id} onChange={e=>setCommissionRuleDraft({...commissionRuleDraft,product_id:e.target.value})}><option value="">Semua produk</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Jenis komisi<select value={commissionRuleDraft.commission_type} onChange={e=>setCommissionRuleDraft({...commissionRuleDraft,commission_type:e.target.value})}><option value="percent">Persentase (%)</option><option value="per_unit">Nominal per unit</option><option value="none">Tanpa komisi</option></select></label><label>Nilai komisi<input type="number" min="0" step="0.01" value={commissionRuleDraft.commission_value} onChange={e=>setCommissionRuleDraft({...commissionRuleDraft,commission_value:e.target.value})} disabled={commissionRuleDraft.commission_type==="none"}/></label><div className="form-actions"><button className="primary" disabled={busy}>Simpan aturan komisi</button></div></form><div className="table-wrap"><table><thead><tr><th>CABANG</th><th>PRODUK</th><th>JENIS</th><th>NILAI</th><th>STATUS</th></tr></thead><tbody>{commissionRules.map(r=><tr key={r.id}><td>{branches.find(b=>b.id===r.branch_id)?.name||"Semua cabang"}</td><td>{products.find(p=>p.id===r.product_id)?.name||"Semua produk"}</td><td>{r.commission_type}</td><td>{r.commission_type==="percent"?r.commission_value+"%":r.commission_type==="per_unit"?money(r.commission_value)+"/unit":"0"}</td><td>{r.is_active?"Aktif":"Nonaktif"}</td></tr>)}</tbody></table></div></section>}
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
          <section className="panel settings"><div className="panel-head"><div><span className="eyebrow">PERANGKAT KASIR</span><h3>Pengaturan Printer</h3><p>Kelola pilihan printer, koneksi perangkat, ukuran kertas, dan uji cetak.</p></div><span className={"badge "+(printerConnection.status==="connected"||printerConnection.status==="permission"?"green":"")}>{printerConnection.status==="connected"?"BLE terhubung":printerConnection.status==="permission"?"Izin USB aktif":"Belum dipilih"}</span></div><div className="form-grid"><label>Ukuran kertas default<select value={receiptWidth} onChange={e=>setReceiptWidth(e.target.value)}><option value="58">Thermal 58 mm</option><option value="80">Thermal 80 mm</option></select></label><label>Nama printer<input value={printerName} onChange={e=>setPrinterName(e.target.value)} placeholder="Nama printer / model"/></label><label className="check-label"><input type="checkbox" checked={autoPrintReceipt} onChange={e=>setAutoPrintReceipt(e.target.checked)}/> Cetak struk otomatis setelah transaksi berhasil</label><label className="check-label"><input type="checkbox" checked={autoOpenCashDrawer} onChange={e=>setAutoOpenCashDrawer(e.target.checked)}/> Kirim perintah buka cash drawer sebelum struk dicetak</label></div><div className="panel" style={{marginTop:14,padding:14,background:"#f7f9fc"}}><b>Printer yang dipilih</b><div style={{marginTop:6}}>{printerName||"Belum ada printer dipilih"}</div><small>{printerConnection.status==="connected"?"Koneksi BLE aktif selama perangkat tetap tersambung.":printerConnection.status==="permission"?"Browser memiliki izin perangkat USB; ini belum menjamin pencetakan ESC/POS langsung.": "Pilih metode koneksi di bawah. Nama yang diisi manual hanya menjadi label, bukan bukti koneksi."}</small></div><div className="form-actions" style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:12}}><button className="primary" type="button" disabled={printerBusy||!printerCapabilities.bluetooth} onClick={connectBluetoothPrinter}> {printerBusy?"Mencari perangkat...":"Cari & hubungkan Bluetooth BLE"}</button><button className="secondary" type="button" disabled={printerBusy||!printerCapabilities.usb} onClick={connectUsbPrinter}>Pilih printer USB</button><button className="secondary" type="button" onClick={printPrinterTest}>Cetak tes</button><button className="secondary" type="button" onClick={kickCashDrawer}>Uji buka cash drawer</button><button className="text-btn" type="button" onClick={disconnectPrinter}>Lepas pilihan</button></div><div className="notice" style={{marginTop:12}}><b>Penting untuk Android:</b> printer thermal Bluetooth yang umum dipakai biasanya memakai Bluetooth Classic (SPP), bukan BLE. Browser tidak dapat memasangkannya langsung dari halaman web. Pasangkan printer melalui Pengaturan Android → Bluetooth, lalu saat menekan Cetak Tes/Cetak Struk pilih nama printer pada dialog cetak atau layanan cetak yang terpasang. Tombol Bluetooth di atas hanya untuk printer BLE yang kompatibel; tombol USB hanya meminta izin perangkat yang didukung browser.</div><p className="warning-note">Untuk cetak Bluetooth langsung tanpa dialog PDF, pasangkan printer di Android lalu jalankan aplikasi Cleanter pada tablet dan pilih printer VSC TM-58V sebagai printer default. Saat opsi cetak otomatis aktif, SMART POS mengirim struk langsung ke layanan lokal Cleanter (localhost:9100). Jika layanan tidak aktif, transaksi tetap tersimpan dan aplikasi menampilkan pesan agar struk dapat dicetak ulang. Integrasi Bluetooth ini belum mengirim perintah cash drawer; fitur laci otomatis memerlukan dukungan khusus dari aplikasi penghubung.</p><p className="warning-note">Status “Izin USB aktif” atau “BLE terhubung” menunjukkan akses perangkat dari browser, bukan jaminan bahwa driver printer dapat mencetak langsung. Untuk cetak otomatis tanpa dialog diperlukan aplikasi/driver pendamping atau integrasi khusus sesuai merek printer.</p></section>
          <section className="panel"><div className="panel-head"><div><span className="eyebrow">LOYALTY PROGRAM</span><h3>Pengaturan Loyalty Point</h3><p>Atur jumlah belanja untuk memperoleh 1 poin dan nilai rupiah saat 1 poin ditukarkan. Program tidak aktif sebelum Owner/Admin menyimpan dan mengaktifkannya.</p></div></div><form className="form-grid" onSubmit={saveLoyaltyProgram}><label className="check-label"><input type="checkbox" checked={Boolean(loyaltyDraft.is_enabled)} onChange={e=>setLoyaltyDraft({...loyaltyDraft,is_enabled:e.target.checked})}/> Aktifkan program Loyalty Point</label><label>Belanja untuk memperoleh 1 poin (Rp)<input type="number" min="1" step="1" value={loyaltyDraft.earn_amount_per_point} onChange={e=>setLoyaltyDraft({...loyaltyDraft,earn_amount_per_point:e.target.value})} placeholder="Contoh: 10000"/></label><label>Nilai hadiah per 1 poin (Rp)<input type="number" min="1" step="1" value={loyaltyDraft.redemption_value_per_point} onChange={e=>setLoyaltyDraft({...loyaltyDraft,redemption_value_per_point:e.target.value})} placeholder="Contoh: 100"/></label><label>Minimum poin untuk ditukar<input type="number" min="1" step="1" value={loyaltyDraft.minimum_redeem_points} onChange={e=>setLoyaltyDraft({...loyaltyDraft,minimum_redeem_points:e.target.value})}/></label><div className="form-actions"><button className="primary" disabled={busy||!["owner","admin"].includes(membership?.role)}>Simpan aturan Loyalty Point</button></div></form><div className="notice">Contoh: jika belanja untuk 1 poin diatur Rp10.000, transaksi lunas Rp125.000 memperoleh 12 poin. Nilai rupiah penukaran dipakai sebagai acuan hadiah manual; potongan otomatis pada checkout belum diaktifkan.</div>{!["owner","admin"].includes(membership?.role)&&<p className="warning-note">Hanya Owner/Admin yang dapat mengatur program poin.</p>}</section>
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
        {receiptData&&<div role="dialog" aria-modal="true" aria-label="Struk transaksi" style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(8,20,35,.62)",display:"grid",placeItems:"center",padding:16}}>
          <section className="panel" style={{width:"min(100%,460px)",maxHeight:"90vh",overflowY:"auto"}}><div className="panel-head"><div><span className="eyebrow">TRANSAKSI BERHASIL</span><h2>Struk siap dicetak</h2><p>Invoice {receiptData.invoiceNo} · {receiptData.status}</p></div><button className="text-btn" onClick={()=>setReceiptData(null)}>Tutup</button></div>
            <div style={{background:"#f7f9fc",border:"1px dashed #9aa8b8",padding:14,borderRadius:10,fontFamily:"monospace",fontSize:12,color:"#172b43"}}><div style={{textAlign:"center",fontWeight:800,fontSize:15}}>{receiptData.businessName}</div><div style={{textAlign:"center"}}>{receiptData.branchName}</div><hr/><div>No: {receiptData.invoiceNo}</div><div>{new Date(receiptData.createdAt).toLocaleString("id-ID")}</div><div>Kasir: {receiptData.cashier}</div><div>Pelanggan: {receiptData.customerName}</div><hr/>{receiptData.items.map((item,i)=><div key={i} style={{marginBottom:8}}><b>{item.name}</b><div>{item.qty} x {money(item.price)} = {money(Math.max(0,item.qty*item.price-item.discount))}</div>{item.discount>0&&<small>Diskon: -{money(item.discount)}</small>}</div>)}<hr/><div>Subtotal: {money(receiptData.subtotal)}</div><div>Diskon: -{money(receiptData.discount)}</div><b style={{fontSize:14}}>TOTAL: {money(receiptData.total)}</b><hr/>{receiptData.payments.map((p,i)=><div key={i}>{p.method}: {money(p.amount)}</div>)}<div>Dibayar: {money(receiptData.paid)}</div><div>Kembalian: {money(receiptData.change||0)}</div><div>Sisa: {money(receiptData.balance)}</div><div style={{textAlign:"center",fontWeight:800,marginTop:8}}>{receiptData.status}</div><hr/><div style={{textAlign:"center"}}>Terima kasih telah berbelanja</div></div>
            <label style={{marginTop:14}}>Ukuran kertas thermal<select value={receiptWidth} onChange={e=>setReceiptWidth(e.target.value)}><option value="58">58 mm</option><option value="80">80 mm</option></select></label><div className="form-actions" style={{display:"flex",gap:8,marginTop:12}}><button className="primary" onClick={()=>printReceiptWithDrawer()}>Cetak struk</button><button className="secondary" onClick={()=>setReceiptData(null)}>Selesai</button></div><small>Di jendela cetak, pilih printer thermal dan ukuran kertas yang sama. Matikan header/footer browser jika tersedia.</small>
          </section></div>}
        <footer>SMART POS JATIBARANG · Data tersimpan di Supabase Cloud</footer>
      </div>
    </main>
  </div>;
}
