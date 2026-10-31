// Generates the bundled product illustrations (original vector art) into public/img/products.
// Run: node tools/gen-product-art.js
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'img', 'products');
fs.mkdirSync(OUT, { recursive: true });

const DEFS = `<defs>
<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a404d"/><stop offset=".55" stop-color="#1f232b"/><stop offset="1" stop-color="#121418"/></linearGradient>
<linearGradient id="m" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#16191f"/><stop offset=".45" stop-color="#4a5160"/><stop offset=".6" stop-color="#2b3039"/><stop offset="1" stop-color="#14171c"/></linearGradient>
<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f5f9"/><stop offset=".5" stop-color="#cbd5e1"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
<radialGradient id="g" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#9ec5ff"/><stop offset=".25" stop-color="#3b82f6"/><stop offset=".6" stop-color="#172554"/><stop offset="1" stop-color="#05070c"/></radialGradient>
<filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="8"/></filter></defs>`;
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${DEFS}<ellipse cx="200" cy="268" rx="140" ry="12" fill="#000" opacity=".45" filter="url(#s)"/>${body}</svg>`;
const EDGE = 'stroke="#4b5563" stroke-opacity=".6"';
const lens = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#m)"/><circle cx="${cx}" cy="${cy}" r="${r - 8}" fill="#0d0f13" stroke="#3a404d" stroke-width="2"/>
<circle cx="${cx}" cy="${cy}" r="${r - 16}" fill="url(#g)"/><circle cx="${cx}" cy="${cy}" r="${r * 0.4}" fill="none" stroke="#93c5fd" stroke-opacity=".35" stroke-width="2"/>
<path d="M${cx - r / 2} ${cy - r / 4} a${r * 0.6} ${r * 0.6} 0 0 1 ${r * 0.6} -${r / 3}" stroke="#fff" stroke-opacity=".7" stroke-width="4" fill="none" stroke-linecap="round"/>`;
const label = (x, y, t, size = 11, fill = '#6b7280') => `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="${fill}" font-weight="700">${t}</text>`;

const ART = {
  'lumen-x1': `<path d="M146 92l14-22h52l14 22z" fill="url(#b)"/><rect x="72" y="90" width="256" height="150" rx="22" fill="url(#b)" ${EDGE}/>
    <rect x="72" y="130" width="62" height="110" rx="18" fill="#15181d"/><path d="M80 140v86" stroke="#2a2f38" stroke-width="2" stroke-dasharray="3 5"/>
    <rect x="262" y="76" width="40" height="14" rx="4" fill="#2b3039"/><circle cx="110" cy="84" r="12" fill="url(#m)"/><rect x="290" y="108" width="22" height="8" rx="3" fill="#3b82f6"/>
    ${lens(220, 168, 64)}${label(298, 232, 'X1')}`,
  'lumen-r5': `<path d="M120 86l16-26h62l16 26z" fill="url(#b)"/><rect x="40" y="84" width="230" height="160" rx="24" fill="url(#b)" ${EDGE}/>
    <rect x="40" y="124" width="64" height="120" rx="20" fill="#15181d"/><circle cx="82" cy="76" r="13" fill="url(#m)"/><circle cx="232" cy="76" r="10" fill="url(#m)"/>
    <rect x="170" y="104" width="190" height="128" rx="14" fill="url(#m)"/><rect x="200" y="104" width="22" height="128" fill="#0d0f13" opacity=".7"/>
    <path d="M204 108v120M210 108v120M216 108v120" stroke="#2b3039" stroke-width="2"/><rect x="262" y="104" width="34" height="128" fill="#0f1115" opacity=".8"/>
    <rect x="340" y="98" width="22" height="140" rx="8" fill="#2b3039"/><ellipse cx="360" cy="168" rx="12" ry="62" fill="url(#g)"/>
    <path d="M356 126q8 10 6 30" stroke="#fff" stroke-opacity=".6" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="170" y="226" width="190" height="6" fill="#ef4444" opacity=".85"/>
    ${label(56, 232, 'R5')}`,
  cinepocket: `<rect x="120" y="44" width="150" height="16" rx="8" fill="#2b3039"/><rect x="138" y="58" width="12" height="28" fill="#2b3039"/><rect x="240" y="58" width="12" height="28" fill="#2b3039"/>
    <rect x="60" y="84" width="230" height="150" rx="16" fill="url(#b)" ${EDGE}/><rect x="78" y="104" width="96" height="62" rx="6" fill="#0b0f19" stroke="#334155"/>
    <rect x="84" y="110" width="84" height="50" rx="3" fill="#1d4ed8" opacity=".55"/><path d="M84 150l22-18 16 12 20-20 26 26v10H84z" fill="#60a5fa" opacity=".6"/>
    <circle cx="96" cy="190" r="8" fill="#ef4444"/><rect x="112" y="184" width="50" height="12" rx="3" fill="#2b3039"/><rect x="290" y="112" width="30" height="96" rx="6" fill="url(#m)"/>
    ${lens(326, 160, 52)}${label(206, 222, 'CINE 6K', 10)}`,
  hero12: `<rect x="230" y="200" width="60" height="44" rx="6" fill="#1a1d23"/><rect x="246" y="186" width="10" height="20" fill="#2b3039"/><rect x="264" y="186" width="10" height="20" fill="#2b3039"/>
    <rect x="110" y="70" width="180" height="140" rx="26" fill="url(#b)" ${EDGE}/><rect x="128" y="88" width="72" height="72" rx="14" fill="#0d0f13"/>${lens(164, 124, 34)}
    <rect x="214" y="92" width="58" height="40" rx="6" fill="#0b0f19" stroke="#334155"/><rect x="218" y="96" width="50" height="32" rx="3" fill="#3b82f6" opacity=".45"/>
    <rect x="236" y="58" width="36" height="14" rx="5" fill="#2563eb"/>${label(208, 192, 'HERO', 16, '#9ca3af')}${label(262, 192, '12', 16, '#3b82f6')}`,
  drone: `<g stroke="#2b3039" stroke-width="14" stroke-linecap="round"><path d="M200 150L95 85M200 150L305 85M200 150L95 215M200 150L305 215"/></g>
    <g fill="url(#m)"><circle cx="95" cy="85" r="15"/><circle cx="305" cy="85" r="15"/><circle cx="95" cy="215" r="15"/><circle cx="305" cy="215" r="15"/></g>
    <g fill="#93c5fd" opacity=".22"><ellipse cx="95" cy="85" rx="62" ry="12"/><ellipse cx="305" cy="85" rx="62" ry="12"/><ellipse cx="95" cy="215" rx="62" ry="12"/><ellipse cx="305" cy="215" rx="62" ry="12"/></g>
    <g stroke="#cbd5e1" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"><path d="M45 82l100 6M255 88l100-6M45 218l100-6M255 212l100 6"/></g>
    <path d="M160 122h80l18 28-18 34h-80l-18-34z" fill="url(#b)" ${EDGE}/><rect x="186" y="128" width="28" height="6" rx="3" fill="#3b82f6"/>
    <rect x="182" y="184" width="36" height="18" rx="4" fill="#1a1d23"/><circle cx="200" cy="206" r="16" fill="url(#m)"/><circle cx="200" cy="206" r="10" fill="url(#g)"/><circle cx="196" cy="202" r="3" fill="#fff" opacity=".7"/>`,
  telephoto: `<rect x="40" y="118" width="40" height="64" rx="6" fill="#1a1d23"/><rect x="74" y="104" width="230" height="92" rx="10" fill="url(#w)"/>
    <rect x="120" y="104" width="40" height="92" fill="#1f232b"/>${[124, 130, 136, 142, 148, 154].map(x => `<path d="M${x} 108v84" stroke="#3a404d" stroke-width="2"/>`).join('')}
    <rect x="200" y="104" width="54" height="92" fill="#1f232b"/>${[204, 212, 220, 228, 236, 244].map(x => `<path d="M${x} 108v84" stroke="#3a404d" stroke-width="2"/>`).join('')}
    <rect x="290" y="92" width="74" height="116" rx="10" fill="#1a1d23"/><ellipse cx="364" cy="150" rx="12" ry="56" fill="url(#g)"/>
    <path d="M360 110q8 12 6 34" stroke="#fff" stroke-opacity=".65" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="74" y="190" width="216" height="6" fill="#ef4444" opacity=".8"/>
    ${label(166, 124, '70–200', 9, '#475569')}`,
  prime35: `<rect x="120" y="96" width="120" height="120" rx="10" fill="url(#m)"/>${[128, 136, 144, 152, 160].map(x => `<path d="M${x} 100v112" stroke="#0f1115" stroke-width="3" opacity=".7"/>`).join('')}
    <rect x="200" y="100" width="8" height="112" fill="#3b82f6" opacity=".8"/><ellipse cx="240" cy="156" rx="34" ry="62" fill="url(#m)"/><ellipse cx="244" cy="156" rx="26" ry="52" fill="#0d0f13"/>
    <ellipse cx="246" cy="156" rx="20" ry="42" fill="url(#g)"/><path d="M240 124q10 6 10 26" stroke="#fff" stroke-opacity=".7" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${label(158, 240, '35mm f/1.4', 12, '#9ca3af')}`,
  'led-light': `<path d="M200 220v40M200 236l-46 30M200 236l46 30" stroke="#2b3039" stroke-width="6" stroke-linecap="round"/><rect x="190" y="180" width="20" height="46" fill="#1a1d23"/>
    <path d="M118 182l24-10M282 182l-24-10" stroke="#2b3039" stroke-width="8" stroke-linecap="round"/>
    <path d="M110 40l-40-24M290 40l40-24M110 184l-40 20M290 184l40 20" stroke="#fde68a" stroke-opacity=".25" stroke-width="10" stroke-linecap="round"/>
    <rect x="110" y="40" width="180" height="144" rx="12" fill="url(#b)" ${EDGE}/><rect x="124" y="54" width="152" height="116" rx="6" fill="#fff7d6"/>
    <g fill="#fde68a">${[64, 84, 104, 124, 144, 160].flatMap(y => [136, 158, 180, 202, 224, 246, 266].map(x => `<circle cx="${x}" cy="${y}" r="6"/>`)).join('')}</g>`,
  'mic-duo': `<rect x="150" y="110" width="100" height="120" rx="14" fill="url(#b)" ${EDGE}/><rect x="166" y="126" width="68" height="34" rx="4" fill="#0b0f19" stroke="#334155"/>
    ${[[172, 8], [180, 14], [188, 10], [196, 18], [204, 12], [212, 16], [220, 6], [228, 10]].map(([x, h]) => `<path d="M${x} 152v-${h}" stroke="#22c55e" stroke-width="4"/>`).join('')}
    <circle cx="200" cy="196" r="14" fill="url(#m)"/><rect x="236" y="70" width="8" height="44" rx="4" fill="#2b3039"/>
    ${[[60, 120, -12], [272, 104, 12]].map(([x, y, r]) => `<g transform="translate(${x} ${y}) rotate(${r})"><rect width="70" height="90" rx="14" fill="url(#b)" ${EDGE}/><circle cx="35" cy="30" r="16" fill="#0d0f13"/><circle cx="35" cy="30" r="10" fill="#1f2937" stroke="#6b7280" stroke-dasharray="2 2"/><circle cx="35" cy="68" r="4" fill="#3b82f6"/></g>`).join('')}`,
  vmount: `<path d="M150 70l12-18h76l12 18" fill="#1a1d23"/><rect x="96" y="70" width="208" height="170" rx="18" fill="url(#b)" ${EDGE}/><rect x="120" y="96" width="160" height="70" rx="8" fill="#15181d"/>
    <text x="200" y="138" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#e5e7eb" font-weight="800">V-MOUNT</text>
    <text x="200" y="156" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#6b7280">14.8V · 150Wh</text>
    ${[140, 170, 200, 230].map((x, i) => `<rect x="${x}" y="190" width="24" height="12" rx="3" fill="${i < 3 ? '#22c55e' : '#374151'}"/>`).join('')}
    <circle cx="276" cy="196" r="9" fill="url(#m)"/><rect x="120" y="214" width="60" height="10" rx="3" fill="#2b3039"/>`,
  tripod: `<path d="M232 56h70" stroke="#2b3039" stroke-width="8" stroke-linecap="round"/><rect x="168" y="40" width="64" height="34" rx="8" fill="url(#b)"/><rect x="186" y="72" width="28" height="40" rx="4" fill="url(#m)"/>
    <g stroke-linecap="round"><path d="M200 112L98 262M200 112L302 262" stroke="#1f232b" stroke-width="14"/><path d="M200 112V268" stroke="#2b3039" stroke-width="14"/>
    <path d="M200 112L98 262M200 112L302 262M200 112v156" stroke="#4b5563" stroke-width="3" stroke-dasharray="40 10"/></g>
    <g fill="#3b82f6"><rect x="140" y="170" width="16" height="10" rx="2" transform="rotate(-34 148 175)"/><rect x="244" y="170" width="16" height="10" rx="2" transform="rotate(34 252 175)"/><rect x="192" y="182" width="16" height="10" rx="2"/></g>`,
  gimbal: `<rect x="182" y="150" width="36" height="112" rx="14" fill="url(#b)" ${EDGE}/><circle cx="200" cy="184" r="8" fill="#3b82f6"/><rect x="194" y="200" width="12" height="30" rx="4" fill="#2b3039"/>
    <circle cx="200" cy="140" r="18" fill="url(#m)"/><path d="M200 128V80h86v34" fill="none" stroke="#2b3039" stroke-width="14" stroke-linejoin="round"/>
    <circle cx="286" cy="118" r="14" fill="url(#m)"/><circle cx="200" cy="80" r="14" fill="url(#m)"/><rect x="132" y="102" width="140" height="74" rx="12" fill="url(#b)" ${EDGE}/>
    ${lens(160, 139, 30)}<rect x="226" y="114" width="34" height="10" rx="3" fill="#2b3039"/>`,
  'nd-filters': `${[[130, 150, '.35', '.5'], [200, 144, '.6', '.3'], [270, 138, '.85', '.15']].map(([x, y, o, g]) => `<circle cx="${x}" cy="${y}" r="72" fill="url(#m)"/><circle cx="${x}" cy="${y}" r="62" fill="#0b0d12"/>
    <circle cx="${x}" cy="${y}" r="60" fill="#111827" opacity="${o}"/><circle cx="${x}" cy="${y}" r="60" fill="url(#g)" opacity="${g}"/>
    <path d="M${x - 36} ${y - 28} a44 44 0 0 1 34 -18" stroke="#fff" stroke-opacity=".55" stroke-width="4" fill="none" stroke-linecap="round"/>`).join('')}
    <g font-family="Arial, sans-serif" font-size="13" font-weight="800" fill="#e5e7eb" text-anchor="middle"><text x="130" y="246">ND4</text><text x="200" y="246">ND6</text><text x="270" y="246">ND10</text></g>`,
  'creator-bundle': `<path d="M150 92q0-34 50-34t50 34" fill="none" stroke="#2b3039" stroke-width="10"/><rect x="88" y="90" width="224" height="160" rx="20" fill="url(#b)" ${EDGE}/>
    <rect x="88" y="130" width="224" height="10" fill="#3b82f6" opacity=".8"/><rect x="170" y="160" width="60" height="36" rx="6" fill="#15181d" stroke="#334155"/>
    <text x="200" y="183" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#9ca3af" font-weight="700">CREATOR</text>
    <g transform="translate(300 150) rotate(18)"><rect width="34" height="44" rx="4" fill="#1e3a8a"/><rect x="4" y="4" width="26" height="12" fill="#e5e7eb"/><text x="17" y="34" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="#fff" font-weight="800">SD</text></g>
    <g transform="translate(62 160) rotate(-14)"><rect width="18" height="70" rx="9" fill="#1a1d23" stroke="#4b5563"/><rect x="2" y="2" width="14" height="22" rx="7" fill="#374151" stroke="#6b7280" stroke-dasharray="2 2"/></g>`,
};

for (const [name, body] of Object.entries(ART)) fs.writeFileSync(path.join(OUT, name + '.svg'), svg(body.replace(/\n\s*/g, '')));
console.log(Object.keys(ART).length, 'illustrations written');
