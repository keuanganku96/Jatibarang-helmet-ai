import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./style.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  document.body.innerHTML = '<main style="font-family:Arial;padding:32px;color:#17233b"><h1>SMART POS JATIBARANG</h1><p>Elemen aplikasi tidak ditemukan. Muat ulang halaman.</p></main>';
} else {
  try {
    createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error("SMART POS startup error:", error);
    rootElement.innerHTML = '<main style="font-family:Arial;padding:32px;color:#17233b"><h1>SMART POS JATIBARANG</h1><p>Aplikasi mengalami kendala saat dimulai. Silakan muat ulang halaman.</p></main>';
  }
}
