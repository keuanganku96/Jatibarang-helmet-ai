import { useEffect, useState } from "react";
import {
  LayoutDashboard, ShoppingCart, Package, Users, ChartNoAxesCombined,
  Settings, ShieldCheck, LogOut, Menu, X, Wifi, WifiOff, Store
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "./supabase";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Kasir", icon: ShoppingCart },
  { label: "Produk & Stok", icon: Package },
  { label: "Pelanggan", icon: Users },
  { label: "Laporan", icon: ChartNoAxesCombined },
  { label: "Pengaturan", icon: Settings }
];

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [active, setActive] = useState("Dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [connection, setConnection] = useState("checking");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setConnection("missing");
      return;
    }
    supabase.auth.getSession().then(({ data, error }) => {
      setSession(data?.session ?? null);
      setConnection(error ? "error" : "connected");
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setBusy(true); setError(""); setNotice("");
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(), password
    });
    if (error) setError(error.message);
    else {
      setSession(data.session);
      setNotice("Login berhasil.");
    }
    setBusy(false);
  }

  async function handleLogout() {
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    if (error) setError(error.message);
    setSession(null);
    setBusy(false);
  }

  if (loading) return <div className="loading">Memeriksa koneksi SMART POS…</div>;

  if (!isSupabaseConfigured) {
    return <main className="setup">
      <div className="brand-mark"><Store size={28} /></div>
      <h1>SMART POS <span>JATIBARANG</span></h1>
      <h2>Konfigurasi belum lengkap</h2>
      <p>Aplikasi belum menemukan Project URL dan Publishable Key. Isi keduanya pada file <code>.env.local</code> sesuai panduan README.</p>
    </main>;
  }

  if (!session) return <main className="login-wrap">
    <section className="login-card">
      <div className="brand-mark"><Store size={28} /></div>
      <p className="eyebrow">JATIBARANG HELMET</p>
      <h1>SMART POS</h1>
      <p className="muted">Masuk ke sistem manajemen bisnis Anda.</p>
      <div className={`connection ${connection}`}>
        {connection === "connected" ? <Wifi size={16}/> : <WifiOff size={16}/>}
        {connection === "connected" ? "Terhubung ke Supabase" : "Koneksi perlu diperiksa"}
      </div>
      <form onSubmit={handleLogin}>
        <label>Email Owner</label>
        <input type="email" autoComplete="username" value={email}
          onChange={e => setEmail(e.target.value)} placeholder="email@contoh.com" required />
        <label>Password</label>
        <input type="password" autoComplete="current-password" value={password}
          onChange={e => setPassword(e.target.value)} placeholder="Password akun Owner" required />
        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}
        <button className="primary full" disabled={busy}>{busy ? "Memproses…" : "Masuk"}</button>
      </form>
      <p className="tiny">Gunakan email dan password yang sudah dibuat di Supabase Authentication. Jangan gunakan PIN karyawan pada halaman ini.</p>
    </section>
  </main>;

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
      <div className="side-brand"><div className="brand-mark small"><Store size={20}/></div><div><b>SMART POS</b><small>JATIBARANG HELMET</small></div><button className="close-menu" onClick={() => setMenuOpen(false)}><X/></button></div>
      <div className="business-chip"><ShieldCheck size={16}/> Owner workspace</div>
      <nav>{navItems.map(item => {
        const Icon = item.icon;
        return <button key={item.label} className={active === item.label ? "nav-item active" : "nav-item"}
          onClick={() => { setActive(item.label); setMenuOpen(false); }}>
          <Icon size={19}/><span>{item.label}</span>
        </button>;
      })}</nav>
      <div className="side-bottom"><span className="status-dot"/> Database online</div>
    </aside>
    {menuOpen && <button className="scrim" aria-label="Tutup menu" onClick={() => setMenuOpen(false)}/>}
    <main className="main">
      <header className="topbar">
        <button className="menu-button" onClick={() => setMenuOpen(true)}><Menu/></button>
        <div><span className="top-label">JATIBARANG HELMET</span><h2>{active}</h2></div>
        <div className="user-box"><span className="avatar">O</span><span className="user-email">{session.user.email}</span><button className="logout" onClick={handleLogout} disabled={busy}><LogOut size={17}/> Keluar</button></div>
      </header>
      <section className="content">
        {active === "Dashboard" ? <>
          <div className="welcome"><div><p className="eyebrow">PUSAT KONTROL BISNIS</p><h1>Selamat datang, Owner.</h1><p className="muted">Fondasi SMART POS sudah terhubung dengan akun Supabase.</p></div><div className="online-badge"><span className="status-dot"/> Sistem terhubung</div></div>
          <div className="notice-card"><ShieldCheck size={22}/><div><b>Login Owner berhasil</b><p>Ini adalah kerangka awal aplikasi. Modul transaksi, produk, stok, dan laporan akan diaktifkan setelah struktur tabel serta aturan keamanan database diperiksa.</p></div></div>
          <div className="stats">
            <div className="stat-card"><span>Penjualan hari ini</span><strong>—</strong><small>Menunggu modul transaksi</small></div>
            <div className="stat-card"><span>Jumlah produk</span><strong>—</strong><small>Menunggu koneksi tabel produk</small></div>
            <div className="stat-card"><span>Stok menipis</span><strong>—</strong><small>Menunggu aturan stok minimum</small></div>
            <div className="stat-card"><span>Pelanggan</span><strong>—</strong><small>Menunggu modul pelanggan</small></div>
          </div>
          <h3>Modul aplikasi</h3>
          <div className="module-grid">{navItems.slice(1).map(item => { const Icon=item.icon; return <button className="module-card" key={item.label} onClick={() => setActive(item.label)}><Icon size={22}/><b>{item.label}</b><span>Siap dikembangkan</span></button>; })}</div>
        </> : <div className="placeholder"><div className="brand-mark"><Store size={26}/></div><h2>{active}</h2><p>Modul ini belum diaktifkan. Kita akan menghubungkannya ke tabel database secara bertahap setelah pemeriksaan keamanan.</p><button className="primary" onClick={() => setActive("Dashboard")}>Kembali ke Dashboard</button></div>}
      </section>
    </main>
  </div>;
}