// PocketBot-dashboard. Datan kommer ur data/*.json som nattjobbet (sim/dashboard/pipeline.py) skriver 05:00.
// Projektionen här är SAMMA modell som pipeline.projektion() — ändras den ena ska den andra följa med.
"use strict";

const LOT_BAS = 2000, GOLV_BAS = 10000, MAX_DAGAR = 252 * 40;
const kr = (v, dec = 0) => (v == null || isNaN(v)) ? "—" :
  v.toLocaleString("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " kr";
const krTecken = (v, dec = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + kr(Math.abs(v), dec);
const datumTxt = s => new Date(s + "T12:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" });
const kortDatum = s => new Date(s + "T12:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function handelsdagPlus(fran, n) {
  const d = new Date(fran + "T12:00:00");
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
  return d.toISOString().slice(0, 10);
}

function takt(rader, konto, n) {
  const urval = n ? rader.slice(-n) : rader;
  return urval.length ? urval.reduce((s, r) => s + r[konto].resultat, 0) / urval.length : 0;
}

// saldo: {konto: kr} för handelskontona + hink (svept hittills). taktK: kr/handelsdag vid LOT_BAS.
function projektion(handel, hinkKonto, saldo, taktK, { golv = GOLV_BAS, lot = LOT_BAS, ater = false, fran, mal }) {
  const skala = lot / LOT_BAS;
  const b = {}, p = {};
  for (const k of handel) { b[k] = saldo[k] + (golv - GOLV_BAS); p[k] = taktK[k] * skala; }
  let hink = saldo[hinkKonto];
  const res = {};
  for (const k of handel) res["breakeven_" + k] = b[k] >= golv ? { dagar: 0, datum: fran } : null;
  res.hink_10k = hink >= mal.hink ? { dagar: 0, datum: fran } : null;
  res.total_100k = null; res.total_1m = null;
  const total = () => handel.reduce((s, k) => s + b[k], 0) + hink;
  if (total() >= mal.m100k) res.total_100k = { dagar: 0, datum: fran };
  if (total() >= mal.m1m) res.total_1m = { dagar: 0, datum: fran };
  for (let d = 1; d <= MAX_DAGAR; d++) {
    for (const k of handel) {
      if (b[k] <= 0) continue;
      b[k] += p[k] * (ater ? b[k] / golv : 1);
      if (!ater && b[k] > golv) { hink += b[k] - golv; b[k] = golv; }
    }
    const klara = [...handel.map(k => ["breakeven_" + k, b[k] >= golv]),
      ["hink_10k", hink >= mal.hink], ["total_100k", total() >= mal.m100k], ["total_1m", total() >= mal.m1m]];
    let datum = null;
    for (const [namn, klar] of klara) {
      if (klar && res[namn] == null) { datum = datum || handelsdagPlus(fran, d); res[namn] = { dagar: d, datum }; }
    }
    if (Object.values(res).every(v => v != null)) break;
  }
  return { mal: res, slut: { ...b, hink } };
}

let D = null, grafer = {};

async function ladda() {
  const t = Date.now();
  const hamta = n => fetch(`data/${n}.json?t=${t}`).then(r => { if (!r.ok) throw new Error(n); return r.json(); });
  const [meta, daily, history, events] = await Promise.all(["meta", "daily", "history", "events"].map(hamta));
  D = { meta, daily, history, events };
  document.getElementById("stamp").textContent =
    "Uppdaterad " + new Date(meta.uppdaterad).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" })
    + " · senaste handelsdag " + datumTxt(daily[daily.length - 1].datum);
  ritaKonton(); rakna(); ritaGrafer(); ritaHistorik(); ritaHandelser();
}

function kontoFarg(k) {
  return k === D.meta.hink ? css("--c-hink") : k === D.meta.handel[0] ? css("--c-godis") : css("--c-basen");
}

function ritaKonton() {
  const { meta, daily } = D, el = document.getElementById("konton");
  const n = +document.getElementById("fonster").value;
  const sist = daily[daily.length - 1];
  const vecka = daily.slice(-5);
  let html = "";
  for (const k of meta.handel) {
    const v = meta.saldo[k], diff = v - meta.golv;
    const sedanStart = daily.reduce((s, r) => s + r[k].resultat, 0);
    html += `<div class="kort" style="--farg:${kontoFarg(k)}">
      <div class="namn">${meta.konton[k]}</div>
      <div class="stort">${kr(v)}</div>
      <div class="rad"><span>Mot 10 000 kr</span><b class="${diff >= 0 ? "plus" : "minus"}">${krTecken(diff)}</b></div>
      <div class="rad"><span>Takt (${n || "alla"} dgr)</span><b>${krTecken(takt(daily, k, n))}/dag</b></div>
      <div class="rad"><span>Senaste dagen</span><b class="${sist[k].resultat >= 0 ? "plus" : "minus"}">${krTecken(sist[k].resultat)}</b></div>
      <div class="rad"><span>Senaste 5 dgr</span><b>${krTecken(vecka.reduce((s, r) => s + r[k].resultat, 0))} · ${vecka.reduce((s, r) => s + r[k].affarer, 0)} aff</b></div>
      <div class="rad"><span>Sedan start</span><b class="${sedanStart >= 0 ? "plus" : "minus"}">${krTecken(sedanStart)}</b></div>
    </div>`;
  }
  const h = meta.hink;
  html += `<div class="kort" style="--farg:${kontoFarg(h)}">
    <div class="namn">Hinken (${meta.konton[h]})</div>
    <div class="stort">${kr(meta.svept)}</div>
    <div class="rad"><span>Svept hittills</span><b>${kr(meta.svept)}</b></div>
    <div class="rad"><span>Saldo nu</span><b>${kr(meta.saldo[h])}</b></div>
    <div class="rad"><span>Uttaget</span><b>${kr(meta.svept - meta.saldo[h])}</b></div>
  </div>`;
  html += `<div class="kort" style="--farg:${css("--c-total")}">
    <div class="namn">Totalt</div>
    <div class="stort">${kr(meta.total)}</div>
    <div class="rad"><span>Handelskonton + svept</span><b>${kr(meta.total)}</b></div>
    <div class="rad"><span>Insatt kapital</span><b>${kr(meta.golv * meta.handel.length)}</b></div>
  </div>`;
  el.innerHTML = html;
}

function inst() {
  return {
    kapital: Math.max(1000, +document.getElementById("kapital").value || GOLV_BAS),
    lot: Math.max(100, +document.getElementById("lot").value || LOT_BAS),
    n: +document.getElementById("fonster").value,
    ater: document.getElementById("ater").checked,
  };
}

function malKort(titel, v, extra = "") {
  if (!v) return `<div class="mal aldrig"><div class="titel">${titel}</div><div class="datum">Nås inte i nuvarande takt</div><div class="om">${extra}</div></div>`;
  if (v.dagar === 0) return `<div class="mal klar"><div class="titel">${titel}</div><div class="datum">Uppnått</div><div class="om">${extra}</div></div>`;
  const ar = v.dagar / 252;
  const omTxt = v.dagar < 504 ? `om ${v.dagar} handelsdagar` : `om ${v.dagar} handelsdagar (≈ ${ar.toFixed(1).replace(".", ",")} år)`;
  return `<div class="mal"><div class="titel">${titel}</div><div class="datum">${datumTxt(v.datum)}</div><div class="om">${omTxt}${extra ? " · " + extra : ""}</div></div>`;
}

function bar(titel, varde, mal, farg) {
  const pct = Math.max(0, Math.min(100, varde / mal * 100));
  return `<div><div class="bar-titel"><span>${titel}</span><span>${kr(varde)} av ${kr(mal)} · ${pct.toFixed(1).replace(".", ",")} %</span></div>
    <div class="bar" role="progressbar" aria-valuenow="${pct.toFixed(1)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%;background:${farg}"></div></div></div>`;
}

function rakna() {
  const { meta, daily } = D, s = inst();
  const handel = meta.handel, hink = meta.hink;
  const tk = {}; for (const k of handel) tk[k] = takt(daily, k, s.n);
  const saldo = { ...Object.fromEntries(handel.map(k => [k, meta.saldo[k]])), [hink]: meta.svept };
  const idag = new Date().toISOString().slice(0, 10);
  const { mal } = projektion(handel, hink, saldo, tk,
    { golv: s.kapital, lot: s.lot, ater: s.ater, fran: idag, mal: { hink: meta.malHink, m100k: meta.mal100k, m1m: meta.mal1m } });

  const extraKap = (s.kapital - GOLV_BAS) * handel.length;
  const total = meta.total + extraKap;
  document.getElementById("mal").innerHTML =
    handel.map(k => malKort(`${meta.konton[k]} tillbaka på ${kr(s.kapital)}`, mal["breakeven_" + k])).join("")
    + malKort(`${kr(meta.malHink)} i hinken`, mal.hink_10k)
    + malKort("100 000 kr totalt", mal.total_100k)
    + malKort("1 000 000 kr totalt", mal.total_1m);

  document.getElementById("framsteg").innerHTML =
    handel.map(k => bar(`${meta.konton[k]} mot ${kr(s.kapital)}`, meta.saldo[k] + (s.kapital - GOLV_BAS), s.kapital, kontoFarg(k))).join("")
    + bar(`Hinken mot ${kr(meta.malHink)}`, meta.svept, meta.malHink, kontoFarg(hink))
    + bar("Totalt mot 100 000 kr", total, meta.mal100k, css("--accent"))
    + bar("Totalt mot 1 000 000 kr", total, meta.mal1m, css("--accent"));

  const skala = s.lot / LOT_BAS;
  document.getElementById("prognos-hint").textContent =
    "Takt " + handel.map(k => `${meta.konton[k]} ${krTecken(tk[k] * skala)}/dag`).join(", ")
    + ` (${s.n ? "senaste " + s.n : "alla"} handelsdagar${skala !== 1 ? ", skalad till lot " + kr(s.lot) : ""}).`
    + (s.ater ? " Vinsten återinvesteras." : " Allt över kapitalet sveps till hinken.");

  const hint = [];
  if (s.kapital !== GOLV_BAS || s.lot !== LOT_BAS || s.ater || s.n !== 20) hint.push("Simulerat läge – nattens ögonblicksbild i tabellen nedan använder 10 000 kr, lot 2 000 kr, 20 dagar.");
  if (s.kapital !== GOLV_BAS) hint.push(`Utökat kapital: ${krTecken(s.kapital - GOLV_BAS)} insatt per handelskonto.`);
  const platser = Math.floor(s.kapital / s.lot);
  if (platser < 3) hint.push(`<span class="varning">Kapitalet räcker bara till ${platser} samtidiga positioner – boten håller upp till 3 per konto.</span>`);
  if (s.lot !== LOT_BAS) hint.push(`Antar att varje affär ger samma procent som hittills, så kronorna skalar med insatsen (×${skala.toLocaleString("sv-SE", { maximumFractionDigits: 2 })}).`);
  document.getElementById("sim-hint").innerHTML = hint.join(" ");
}

function ritaGrafer() {
  const { meta, daily } = D;
  const etiketter = daily.map(r => kortDatum(r.datum));
  const rutnat = css("--linje"), text = css("--dampad");
  const bas = {
    responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { labels: { color: text, boxWidth: 12 } },
      tooltip: { callbacks: { label: c => `${c.dataset.label}: ${kr(c.parsed.y)}` } } },
    scales: { x: { ticks: { color: text, maxTicksLimit: 10 }, grid: { display: false } },
      y: { ticks: { color: text, callback: v => v.toLocaleString("sv-SE") }, grid: { color: rutnat } } },
  };
  for (const g of Object.values(grafer)) g.destroy();
  const ds = meta.handel.map(k => ({ label: meta.konton[k], data: daily.map(r => r[k].varde), borderColor: kontoFarg(k), backgroundColor: kontoFarg(k), borderWidth: 2, pointRadius: 0, tension: .2 }));
  ds.push({ label: "Hinken (svept)", data: daily.map(r => r.svept), borderColor: kontoFarg(meta.hink), backgroundColor: kontoFarg(meta.hink), borderWidth: 2, pointRadius: 0, tension: .2 });
  ds.push({ label: "Totalt", data: daily.map(r => meta.handel.reduce((s, k) => s + r[k].varde, 0) + r.svept), borderColor: css("--c-total"), backgroundColor: css("--c-total"), borderWidth: 2.5, pointRadius: 0, tension: .2 });
  grafer.varde = new Chart(document.getElementById("graf-varde"), { type: "line", data: { labels: etiketter, datasets: ds }, options: bas });
  grafer.dag = new Chart(document.getElementById("graf-dag"), {
    type: "bar",
    data: { labels: etiketter, datasets: meta.handel.map(k => ({ label: meta.konton[k], data: daily.map(r => r[k].resultat), backgroundColor: kontoFarg(k), borderRadius: 2 })) },
    options: { ...bas, scales: { ...bas.scales, x: { ...bas.scales.x, stacked: true }, y: { ...bas.scales.y, stacked: true } } },
  });
}

function ritaHistorik() {
  const { meta, history } = D;
  const kol = [...meta.handel.map(k => ["breakeven_" + k, meta.konton[k] + " 10 000"]), ["hink_10k", "Hinken 10 000"],
    ["total_100k", "100 000 kr"], ["total_1m", "1 000 000 kr"]];
  let html = `<thead><tr><th>Handelsdag</th><th>Resultat</th><th>Takt/dag</th>${kol.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead><tbody>`;
  const rader = [...history].reverse();
  rader.forEach((h, i) => {
    const forra = rader[i + 1];
    const res = Object.values(h.resultat || {}).reduce((a, b) => a + b, 0);
    const tk = Object.values(h.takt || {}).reduce((a, b) => a + b, 0);
    html += `<tr class="${h.efterhand ? "efterhand" : ""}"><td>${datumTxt(h.datum)}${h.efterhand ? '<span class="tagg" title="Beräknad i efterhand ur Avanzas transaktioner">efterhand</span>' : ""}</td>
      <td class="${res >= 0 ? "plus" : "minus"}">${krTecken(res)}</td><td>${krTecken(tk)}</td>`;
    for (const [nyckel] of kol) {
      const v = h.mal[nyckel], f = forra && forra.mal[nyckel];
      if (!v) { html += `<td title="Nås inte i den takten">—</td>`; continue; }
      if (v.dagar === 0) { html += `<td class="plus">uppnått</td>`; continue; }
      let delta = "";
      if (f && f.dagar != null) {
        const dd = v.dagar - f.dagar;
        delta = dd === 0 ? " (±0)" : ` <span class="${dd > 0 ? "minus" : "plus"}">(${dd > 0 ? "+" : "−"}${Math.abs(dd)})</span>`;
      } else if (forra && !f) delta = ` <span class="plus">(ny)</span>`;
      html += `<td title="${datumTxt(v.datum)}">${v.dagar} d${delta}</td>`;
    }
    html += "</tr>";
  });
  document.getElementById("historik").innerHTML = html + "</tbody>";
}

function ritaHandelser() {
  const el = document.getElementById("handelser");
  if (!D.events.length) { el.innerHTML = "<li>Inga händelser ännu.</li>"; return; }
  el.innerHTML = D.events.map(e => `<li>
    <span>${new Date(e.tid).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
    <span class="typ ${e.typ}">${e.typ === "in" ? "IN" : e.typ === "ut" ? "UT" : "FLYTT"}</span>
    <span><span class="id">${e.id}</span> · ${e.konto}</span>
    ${e.skal ? `<span class="skal">${e.skal}</span>` : ""}</li>`).join("");
}

for (const id of ["kapital", "lot", "fonster", "ater"]) {
  document.getElementById(id).addEventListener("input", () => { if (D) { rakna(); ritaKonton(); } });
}
document.getElementById("aterstall").addEventListener("click", () => {
  document.getElementById("kapital").value = 10000; document.getElementById("lot").value = 2000;
  document.getElementById("fonster").value = "20"; document.getElementById("ater").checked = false;
  rakna(); ritaKonton();
});
ladda().catch(e => { document.getElementById("stamp").textContent = "Kunde inte läsa datan (" + e.message + ")"; });
