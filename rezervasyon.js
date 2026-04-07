@@ -0,0 +1,187 @@
// ═══════════════════════════════════════════════════════════
// HALİSAHA OTOMATİK REZERVASYON — v2 (Polling + Auto-Book)
// ═══════════════════════════════════════════════════════════
// Tarayıcı konsoluna yapıştır. Slot açılana kadar bekler,
// açılınca otomatik rezervasyon yapar.

const HEDEF_SAAT = "16:00";       // ← hedef seans saati
const YOKLAMA_MS = 3000;          // ← kaç ms'de bir kontrol (3 saniye)
const MAX_DENEME = 600;           // ← en fazla kaç deneme (600 × 3s = ~30 dk)

// ── Sayfadan hidden field'ları al ──
function getHiddenFields(doc = document) {
  const data = new URLSearchParams();
  doc.querySelectorAll("#form11 input[type=hidden]").forEach(i => {
    data.append(i.name, i.value);
  });
  return data;
}

// ── Sayfanın güncel HTML'ini fetch ile çek, DOM olarak parse et ──
async function sayfayiCek() {
  const r = await fetch(location.href, { credentials: "include" });
  const html = await r.text();
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

// ── Async postback (UpdatePanel) ──
async function asyncPostback(eventTarget, extraFields = {}, doc = document) {
  const data = getHiddenFields(doc);
  data.set("__EVENTTARGET", eventTarget);
  data.set("__EVENTARGUMENT", "");
  data.set("__ASYNCPOST", "true");
  data.set("ctl00$pageContent$ScriptManager1",
    "ctl00$pageContent$UpdatePanel1|" + eventTarget);
  Object.entries(extraFields).forEach(([k, v]) => data.set(k, v));

  const formAction = doc.getElementById("form11")?.action || document.getElementById("form11").action;
  const r = await fetch(formAction, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "X-MicrosoftAjax": "Delta=true",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: data.toString(),
    credentials: "include"
  });
  const text = await r.text();

  // Delta response'dan yeni VIEWSTATE'i sayfaya yaz
  const vsMatch = text.match(/\d+\|hiddenField\|__VIEWSTATE\|([^|]+)\|/);
  if (vsMatch) {
    const vsInput = document.querySelector("input[name='__VIEWSTATE']");
    if (vsInput) {
      vsInput.value = vsMatch[1];
      console.log("🔄 VIEWSTATE güncellendi");
    }
  }

  return text;
}

// ── Hedef slotu bul (parse edilmiş DOM üzerinde) ──
function slotuBul(doc) {
  const slots = [...doc.querySelectorAll("a[href*='lbRezervasyon']")];
  return slots.find(a => {
    const p = a.closest("tr") || a.closest("div") || a.parentElement;
    return p && p.innerText.includes(HEDEF_SAAT);
  });
}

// ── Rezervasyon akışı ──
async function rezervasyonYap(hedef, doc) {
  const target = hedef.href.match(/'([^']+)'/)?.[1];
  if (!target) {
    console.error("❌ Event target parse edilemedi");
    return false;
  }

  console.log("✅ Slot bulundu:", target);
  console.log("📤 Adım 1: Rezervasyon gönderiliyor...");

  // Önce asıl sayfadaki VIEWSTATE'i güncelle (fetch edilen sayfadan)
  const fetchedVS = doc.querySelector("input[name='__VIEWSTATE']")?.value;
  if (fetchedVS) {
    const liveVS = document.querySelector("input[name='__VIEWSTATE']");
    if (liveVS) liveVS.value = fetchedVS;
  }

  const r1 = await asyncPostback(target);
  console.log("Adım 1 cevabı:", r1.substring(0, 200));

  if (!r1.includes("gerçekleşebilir")) {
    console.warn("❌ Rezervasyon onayı gelmedi. Slot dolu veya hata var.");
    console.warn(r1.substring(0, 300));
    return false;
  }

  console.log("✅ Adım 1 tamam — Sepete ekleniyor...");

  // ── ADIM 2: Sepete Ekle ──
  const r2 = await asyncPostback("ctl00$pageContent$lbtnSepeteEkle");
  console.log("Adım 2 cevabı:", r2.substring(0, 200));

  if (!r2.includes("doğrulama") && !r2.includes("SMS") && !r2.includes("telefon")) {
    console.warn("❌ SMS adımı gelmedi.");
    console.warn(r2.substring(0, 300));
    return false;
  }

  console.log("✅ SMS gönderildi!");

  // ── ADIM 3: SMS Doğrulama ──
  const sms = prompt("📱 Telefonuna gelen SMS kodunu gir:");
  if (!sms) {
    console.warn("⚠️ SMS kodu girilmedi, iptal.");
    return false;
  }

  const data = getHiddenFields();
  data.set("__EVENTTARGET", "");
  data.set("__EVENTARGUMENT", "");
  data.set("ctl00$pageContent$txtDogrulamaKodu", sms);
  data.set("ctl00$pageContent$btnCepTelDogrulamaGonder", "Kodunu Doğrula");

  const r3 = await fetch(document.getElementById("form11").action, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: data.toString(),
    credentials: "include"
  });
  const html3 = await r3.text();

  if (html3.includes("başarı") || html3.includes("tamamlandı") || html3.includes("onaylandı")) {
    alert("🎉 REZERVASYON TAMAMLANDI!");
    return true;
  } else {
    alert("⚠️ Sonuç belirsiz — sayfayı yenile ve kontrol et.");
    return true; // durma, zaten adım atıldı
  }
}

// ══════════════════════════════════════════════════
// ANA DÖNGÜ — Slot açılana kadar bekle, açılınca kitla
// ══════════════════════════════════════════════════
(async () => {
  console.log(`⏳ ${HEDEF_SAAT} slotu bekleniyor...`);
  console.log(`   Kontrol aralığı: ${YOKLAMA_MS / 1000}s | Max deneme: ${MAX_DENEME}`);
  console.log(`   Durdurmak için: clearInterval(window._rez_timer)`);

  let deneme = 0;
  let calisiyor = false; // aynı anda iki kontrol çakışmasın

  window._rez_timer = setInterval(async () => {
    if (calisiyor) return;
    calisiyor = true;
    deneme++;

    try {
      // 1) Sayfayı arka planda çek
      const doc = await sayfayiCek();

      // 2) Slotu ara
      const hedef = slotuBul(doc);

      if (!hedef) {
        console.log(`[${deneme}/${MAX_DENEME}] ⏳ ${HEDEF_SAAT} slotu henüz yok...`);
      } else {
        console.log(`[${deneme}] 🎯 SLOT AÇILDI! Rezervasyon başlatılıyor...`);
        clearInterval(window._rez_timer);
        await rezervasyonYap(hedef, doc);
        return;
      }

      if (deneme >= MAX_DENEME) {
        clearInterval(window._rez_timer);
        console.warn(`⛔ ${MAX_DENEME} deneme doldu, durduruluyor.`);
        alert(`⛔ ${HEDEF_SAAT} slotu ${MAX_DENEME} denemede bulunamadı.`);
      }
    } catch (err) {
      console.error("❌ Hata:", err.message);
    } finally {
      calisiyor = false;
    }
  }, YOKLAMA_MS);
})();
