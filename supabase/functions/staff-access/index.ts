import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function b64(bytes: Uint8Array) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(value: string) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
async function hashPin(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, key, 256);
  return `pbkdf2-sha256$310000$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}
async function verifyPin(pin: string, stored: string) {
  const [kind, iterationsText, saltText, hashText] = stored.split("$");
  const iterations = Number(iterationsText);
  if (kind !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 200000 || iterations > 1000000 || !saltText || !hashText) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: unb64(saltText), iterations, hash: "SHA-256" }, key, 256));
  const expected = unb64(hashText);
  if (bits.length !== expected.length) return false;
  let diff = 0; for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}
function validUuid(v: unknown) { return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }

const url = Deno.env.get("SUPABASE_URL") ?? "";
const secretMap = Deno.env.get("SUPABASE_SECRET_KEYS");
const secretKey = secretMap ? JSON.parse(secretMap).default : (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function ownerContext(req: Request, businessId: string) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sesi Owner diperlukan.");
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) throw new Error("Sesi login tidak valid.");
  const { data: member, error } = await admin.from("business_members").select("business_id,role,is_active")
    .eq("business_id", businessId).eq("user_id", user.id).eq("is_active", true).maybeSingle();
  if (error || !member || !["owner", "admin"].includes(member.role)) throw new Error("Hanya Owner/Admin aktif yang dapat melakukan tindakan ini.");
  return { user, member };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method tidak didukung." }, 405);
  try {
    if (!url || !secretKey) return json({ error: "Konfigurasi rahasia Edge Function belum tersedia." }, 500);
    const body = await req.json();
    const action = String(body.action ?? "");

    if (action === "pair_device") {
      const { business_id, branch_id, device_id, device_label } = body;
      if (!validUuid(business_id) || !validUuid(branch_id) || !validUuid(device_id)) return json({ error: "Identitas bisnis, cabang, atau perangkat tidak valid." }, 400);
      const { user } = await ownerContext(req, business_id);
      const { data: branch } = await admin.from("branches").select("id").eq("id", branch_id).eq("business_id", business_id).eq("is_active", true).maybeSingle();
      if (!branch) return json({ error: "Cabang tidak ditemukan atau tidak aktif." }, 404);
      const { data: existing } = await admin.from("staff_devices").select("device_id,business_id").eq("device_id", device_id).maybeSingle();
      if (existing && existing.business_id !== business_id) return json({ error: "Perangkat sudah terhubung ke bisnis lain." }, 409);
      const { error } = await admin.from("staff_devices").upsert({ device_id, business_id, branch_id, device_label: String(device_label ?? "Perangkat kasir").slice(0, 80), approved_by: user.id, approved_at: new Date().toISOString(), revoked_at: null }, { onConflict: "device_id" });
      if (error) throw error;
      await admin.from("staff_pin_audit").insert({ business_id, device_id, event_type: "device_paired", details: { branch_id } });
      return json({ ok: true, message: "Perangkat berhasil dipasangkan." });
    }

    if (action === "create_staff" || action === "set_pin") {
      const { business_id, branch_id, staff_profile_id, employee_code, full_name, phone, job_title, pin, role, commission_type, commission_value } = body;
      if (!validUuid(business_id)) return json({ error: "Business ID tidak valid." }, 400);
      const { user } = await ownerContext(req, business_id);
      if (!/^\d{6}$/.test(String(pin ?? ""))) return json({ error: "PIN harus terdiri dari 6 angka." }, 400);
      if (action === "set_pin") {
        if (!validUuid(staff_profile_id)) return json({ error: "Profil karyawan tidak valid." }, 400);
        const { data: profile } = await admin.from("staff_profiles").select("id,business_id").eq("id", staff_profile_id).eq("business_id", business_id).maybeSingle();
        if (!profile) return json({ error: "Profil karyawan tidak ditemukan." }, 404);
        const pin_hash = await hashPin(String(pin));
        const { error } = await admin.from("staff_pin_credentials").upsert({ staff_profile_id, business_id, pin_hash, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }, { onConflict: "staff_profile_id" });
        if (error) throw error;
        await admin.from("staff_pin_audit").insert({ business_id, staff_profile_id, event_type: "pin_changed", details: { changed_by: user.id } });
        return json({ ok: true, message: "PIN karyawan berhasil diperbarui." });
      }
      if (!validUuid(branch_id) || !/^[A-Z0-9_-]{2,32}$/.test(String(employee_code ?? "").trim().toUpperCase()) || String(full_name ?? "").trim().length < 2) return json({ error: "Nama, kode karyawan, atau cabang belum valid." }, 400);
      if (!["cashier", "staff", "manager"].includes(String(role ?? "cashier"))) return json({ error: "Peran karyawan tidak valid." }, 400);
      const { data: branch } = await admin.from("branches").select("id").eq("id", branch_id).eq("business_id", business_id).eq("is_active", true).maybeSingle();
      if (!branch) return json({ error: "Cabang tidak ditemukan atau tidak aktif." }, 404);

      const userId = crypto.randomUUID();
      const profileId = crypto.randomUUID();
      const syntheticEmail = `staff+${userId}@jatibarang-helmet.com`;
      const generatedPassword = `${crypto.randomUUID()}-${crypto.randomUUID()}-Aa9!`;
      const { data: created, error: createError } = await admin.auth.admin.createUser({ id: userId, email: syntheticEmail, password: generatedPassword, email_confirm: true, user_metadata: { display_name: String(full_name).trim().slice(0, 120), account_type: "staff" } });
      if (createError || !created.user) throw createError ?? new Error("Gagal membuat akun karyawan.");
      const memberInsert = await admin.from("business_members").insert({ business_id, user_id: created.user.id, branch_id, role: String(role ?? "cashier"), is_active: true });
      if (memberInsert.error) { await admin.auth.admin.deleteUser(created.user.id); throw memberInsert.error; }
      const profileInsert = await admin.from("staff_profiles").insert({
        id: profileId, business_id, user_id: created.user.id, branch_id, employee_code: String(employee_code).trim().toUpperCase(),
        full_name: String(full_name).trim().slice(0, 120), phone: phone ? String(phone).slice(0, 30) : null,
        job_title: job_title ? String(job_title).slice(0, 80) : null,
        commission_type: ["percent", "per_unit", "none"].includes(String(commission_type)) ? commission_type : "none",
        commission_value: Math.max(0, Number(commission_value) || 0),
      });
      if (profileInsert.error) { await admin.from("staff_profiles").delete().eq("id", profileId); await admin.from("business_members").delete().eq("business_id", business_id).eq("user_id", created.user.id); await admin.auth.admin.deleteUser(created.user.id); throw profileInsert.error; }
      const pin_hash = await hashPin(String(pin));
      const credentialInsert = await admin.from("staff_pin_credentials").insert({ staff_profile_id: profileId, business_id, pin_hash });
      if (credentialInsert.error) { await admin.from("staff_profiles").delete().eq("id", profileId); await admin.from("business_members").delete().eq("business_id", business_id).eq("user_id", created.user.id); await admin.auth.admin.deleteUser(created.user.id); throw credentialInsert.error; }
      await admin.from("staff_pin_audit").insert({ business_id, staff_profile_id: profileId, event_type: "created", details: { created_by: user.id, employee_code } });
      return json({ ok: true, staff_profile_id: profileId, user_id: created.user.id, employee_code: String(employee_code).trim().toUpperCase(), message: "Akun karyawan dan PIN berhasil dibuat." });
    }

    if (action === "list_staff") {
      const { business_id, device_id } = body;
      if (!validUuid(business_id) || !validUuid(device_id)) return json({ error: "Perangkat belum dikenali." }, 400);
      const { data: device } = await admin.from("staff_devices").select("device_id,business_id,branch_id").eq("device_id", device_id).eq("business_id", business_id).is("revoked_at", null).maybeSingle();
      if (!device) return json({ error: "Perangkat belum disetujui Owner." }, 403);
      const { data, error } = await admin.from("staff_profiles").select("id,employee_code,full_name,job_title,branch_id").eq("business_id", business_id).eq("branch_id", device.branch_id).order("full_name");
      if (error) throw error;
      return json({ ok: true, staff: data ?? [], branch_id: device.branch_id });
    }

    if (action === "staff_login") {
      const { business_id, device_id, employee_code, pin } = body;
      if (!validUuid(business_id) || !validUuid(device_id) || !/^\d{6}$/.test(String(pin ?? ""))) return json({ error: "Kode karyawan atau PIN tidak valid." }, 400);
      const { data: device } = await admin.from("staff_devices").select("device_id,business_id,branch_id").eq("device_id", device_id).eq("business_id", business_id).is("revoked_at", null).maybeSingle();
      if (!device) return json({ error: "Perangkat ini belum disetujui Owner." }, 403);
      const code = String(employee_code ?? "").trim().toUpperCase();
      const { data: profile } = await admin.from("staff_profiles").select("id,user_id,business_id,branch_id,employee_code,full_name").eq("business_id", business_id).eq("branch_id", device.branch_id).eq("employee_code", code).maybeSingle();
      if (!profile) return json({ error: "Kode karyawan atau PIN salah." }, 401);
      const { data: member } = await admin.from("business_members").select("is_active").eq("business_id", business_id).eq("user_id", profile.user_id).maybeSingle();
      if (!member?.is_active) return json({ error: "Akun karyawan tidak aktif." }, 403);
      const { data: credential } = await admin.from("staff_pin_credentials").select("pin_hash,failed_attempts,locked_until").eq("staff_profile_id", profile.id).maybeSingle();
      if (!credential) return json({ error: "PIN belum diatur oleh Owner." }, 403);
      if (credential.locked_until && new Date(credential.locked_until) > new Date()) return json({ error: "PIN terkunci sementara. Hubungi Owner atau tunggu 10 menit." }, 429);
      if (!(await verifyPin(String(pin), credential.pin_hash))) {
        const { data: failures } = await admin.rpc("record_staff_pin_failure", { p_staff_profile_id: profile.id });
        await admin.from("staff_pin_audit").insert({ business_id, staff_profile_id: profile.id, device_id, event_type: "login_failed", details: { employee_code: code } });
        const locked = failures?.[0]?.locked_until;
        return json({ error: locked ? "Terlalu banyak percobaan. PIN dikunci selama 10 menit." : "Kode karyawan atau PIN salah." }, locked ? 429 : 401);
      }
      await admin.rpc("reset_staff_pin_failures", { p_staff_profile_id: profile.id });
      const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(profile.user_id);
      if (getUserError || !authUser.user?.email) throw getUserError ?? new Error("Akun karyawan tidak tersedia.");
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: authUser.user.email });
      if (linkError || !linkData.properties?.hashed_token) throw linkError ?? new Error("Gagal membuat sesi login.");
      await admin.from("staff_pin_audit").insert({ business_id, staff_profile_id: profile.id, device_id, event_type: "login_success", details: { branch_id: device.branch_id } });
      return json({ ok: true, token_hash: linkData.properties.hashed_token, type: "magiclink", staff: { id: profile.id, user_id: profile.user_id, name: profile.full_name, employee_code: profile.employee_code, branch_id: profile.branch_id } });
    }

    if (action === "revoke_device") {
      const { business_id, device_id } = body;
      if (!validUuid(business_id) || !validUuid(device_id)) return json({ error: "Data perangkat tidak valid." }, 400);
      const { user } = await ownerContext(req, business_id);
      const { error } = await admin.from("staff_devices").update({ revoked_at: new Date().toISOString() }).eq("business_id", business_id).eq("device_id", device_id);
      if (error) throw error;
      await admin.from("staff_pin_audit").insert({ business_id, device_id, event_type: "device_revoked", details: { revoked_by: user.id } });
      return json({ ok: true, message: "Akses perangkat dicabut." });
    }
    return json({ error: "Aksi tidak dikenal." }, 400);
  } catch (error) {
    console.error("staff-access error", error);
    return json({ error: error instanceof Error ? error.message : "Terjadi kesalahan server." }, 400);
  }
});