// The $50 Rohrman oil change (op code ROHR50, "Synthetic Oil Change ROH$",
// "ROHRMAN EXCLUSIVE – $50 Oil & Filter Change") is an instant $69 savings off
// the regular $119. Every customer printout that lists it says so.
export const OIL50 = { price: 50, regular: 119, save: 69 };

export const isFiftyOil = (name, code) =>
  /ROHR\s*50|\bROH\s*\$|\$\s*50\s*(?:synthetic\s+)?oil/i.test(`${name || ''} ${code || ''}`);

// Small HTML ribbon for printouts (inline styles so any page can drop it in).
export const oilSavingsRibbon = () =>
  `<div style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:3px 9px;border-radius:999px;white-space:nowrap;`
  + `background:linear-gradient(90deg,#059669,#10b981);color:#fff;font-weight:900;font-size:11px;letter-spacing:.01em;`
  + `-webkit-print-color-adjust:exact;print-color-adjust:exact">⚡ Instant savings $${OIL50.save}`
  + `<span style="font-weight:700;opacity:.9;text-decoration:line-through">Reg. $${OIL50.regular}</span></div>`;
