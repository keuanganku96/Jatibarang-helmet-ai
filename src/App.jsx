import { useState } from "react";

export default function App() {
  const [menu, setMenu] = useState("Dashboard");

  const menus = [
    "Dashboard",
    "Kasir",
    "Produk & Stok",
    "Pelanggan",
    "Pembelian",
    "Laporan",
    "Pengaturan"
  ];

  return (
    <div style={{fontFamily:"Arial",background:"#f4f7fb",minHeight:"100vh"}}>
      <header style={{background:"#101c35",color:"white",padding:20}}>
        <h2>SMART POS JATIBARANG</h2>
        <p>Jatibarang Helmet</p>
      </header>

      <nav style={{display:"flex",flexWrap:"wrap",gap:8,padding:15}}>
        {menus.map(item => (
          <button key={item} onClick={() => setMenu(item)}
            style={{padding:12,border:0,borderRadius:8,background:menu===item?"#159565":"white",color:menu===item?"white":"#17233b"}}>
            {item}
          </button>
        ))}
      </nav>

      <main style={{padding:20}}>
        <h1>{menu}</h1>
        <div style={{background:"white",padding:25,borderRadius:12}}>
          <h3>Selamat datang di SMART POS</h3>
          <p>Sistem kasir dan manajemen Jatibarang Helmet.</p>
          <p>Modul {menu} sedang disiapkan.</p>
        </div>
      </main>
    </div>
  );
}
