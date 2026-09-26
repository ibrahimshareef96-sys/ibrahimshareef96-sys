// Hand-drawn style spot illustrations, one per workflow. All drawn in an 880x460 box.
// Style: ink outlines (--ill-ink), paper fills (--ill-paper), a flat colour shape offset
// behind each object like a slightly misregistered print, and a light wobble filter (#rough).
// Marks drawn straight on the slide background use kb / inkb so they stay visible on dark themes.
  // Colour slots: c1 clay, c2 sky, c3 olive, c4 heather, c5 kraft, c6 oat; c1s / c3s are soft tints.
(function () {
  const svg = (inner) =>
    `<svg class="ill" viewBox="0 0 880 460" aria-hidden="true"><g filter="url(#rough)">${inner}</g></svg>`;

  // Four-point sparkle centred on (x, y).
  const spark = (x, y, s = 18) =>
    `<path class="inkb" d="M${x} ${y - s} Q${x + s * 0.12} ${y - s * 0.12} ${x + s} ${y} Q${x + s * 0.12} ${y + s * 0.12} ${x} ${y + s} Q${x - s * 0.12} ${y + s * 0.12} ${x - s} ${y} Q${x - s * 0.12} ${y - s * 0.12} ${x} ${y - s} Z"/>`;

  // Speech bubble with a tail. side: 'bottom' or 'top'. tx = tail base centre, (px, py) = tip.
  const bubble = (x, y, w, h, r, side, tx, px, py, cls) => {
    const b = 16;
    const top = side === 'top'
      ? `H${tx - b} L${px} ${py} L${tx + b} ${y} H${x + w - r}`
      : `H${x + w - r}`;
    const bottom = side === 'bottom'
      ? `H${tx + b} L${px} ${py} L${tx - b} ${y + h} H${x + r}`
      : `H${x + r}`;
    return `<path class="${cls}" d="M${x + r} ${y} ${top} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} ${bottom} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z"/>`;
  };

  // One reviewer on The Panel: a coloured head with an eye looking at (lx, ly).
  const reviewer = (cx, cy, cls, lx, ly) => {
    const dx = lx - cx, dy = ly - cy, d = Math.hypot(dx, dy);
    const px = cx + (dx / d) * 7, py = cy + (dy / d) * 5;
    return `<circle class="kf ${cls}" cx="${cx}" cy="${cy}" r="40"/>` +
      `<ellipse class="p" style="stroke-width:5" cx="${cx}" cy="${cy}" rx="21" ry="13"/>` +
      `<circle class="ink" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7"/>`;
  };

  const ILL = {};

  // SUN: plan the week. Clipboard brief, evening moon.
  ILL.plan = svg(`
    <g transform="rotate(-32 205 330)">
      <rect class="kf c5" x="95" y="310" width="200" height="42" rx="6"/>
      <path class="p" d="M295 310 L345 331 L295 352 Z"/>
      <path class="ink" d="M330 325 L346 331 L330 337 Z"/>
      <rect class="kf c1" x="58" y="310" width="40" height="42" rx="7"/>
      <line class="k" style="stroke-width:4" x1="112" y1="331" x2="282" y2="331"/>
    </g>
    <rect class="c2" x="324" y="64" width="280" height="386" rx="28"/>
    <rect class="p" x="302" y="44" width="280" height="386" rx="28"/>
    <rect class="kf c1" x="384" y="22" width="116" height="50" rx="14"/>
    <line class="k" style="stroke-width:11" x1="342" y1="118" x2="468" y2="118"/>
    <rect class="p" style="stroke-width:5" x="342" y="158" width="32" height="32" rx="7"/>
    <path class="k" style="stroke:var(--ill-c1);stroke-width:7" d="M347 174 l9 9 l19 -23"/>
    <line class="k" style="stroke-width:6;opacity:.3" x1="392" y1="174" x2="540" y2="174"/>
    <rect class="p" style="stroke-width:5" x="342" y="212" width="32" height="32" rx="7"/>
    <line class="k" style="stroke-width:6" x1="392" y1="228" x2="522" y2="228"/>
    <rect class="p" style="stroke-width:5" x="342" y="266" width="32" height="32" rx="7"/>
    <line class="k" style="stroke-width:6" x1="392" y1="282" x2="492" y2="282"/>
    <line class="k" style="stroke-width:5" x1="342" y1="398" x2="544" y2="398"/>
    <rect class="kf c2" style="stroke-width:5" x="350" y="358" width="26" height="40" rx="4"/>
    <rect class="kf c2" style="stroke-width:5" x="390" y="332" width="26" height="66" rx="4"/>
    <rect class="kf c2" style="stroke-width:5" x="430" y="346" width="26" height="52" rx="4"/>
    <rect class="kf c1" style="stroke-width:5" x="470" y="318" width="26" height="80" rx="4"/>
    <rect class="kf c2" style="stroke-width:5" x="510" y="338" width="26" height="60" rx="4"/>
    <path class="kf c5" d="M684.5 58.3 A62 62 0 1 0 748.7 139.9 A52 52 0 0 1 684.5 58.3 Z"/>
    ${spark(800, 88, 20)}${spark(652, 214, 12)}
    <circle class="inkb" cx="782" cy="200" r="6"/>
  `);

  // MON: build in Claude Code. Terminal plus the CRM's iOS app with its Face ID lock.
  ILL.build = svg(`
    <rect class="c1" x="122" y="60" width="500" height="340" rx="26"/>
    <rect class="p" x="100" y="40" width="500" height="340" rx="26"/>
    <line class="k" x1="100" y1="100" x2="600" y2="100"/>
    <circle class="kf c1" style="stroke-width:4" cx="140" cy="70" r="11"/>
    <circle class="kf c5" style="stroke-width:4" cx="175" cy="70" r="11"/>
    <circle class="kf c3" style="stroke-width:4" cx="210" cy="70" r="11"/>
    <path class="k" style="stroke:var(--ill-c1);stroke-width:8" d="M140 138 L162 153 L140 168"/>
    <line class="k" style="stroke-width:10" x1="186" y1="153" x2="380" y2="153"/>
    <line class="k" style="stroke-width:9" x1="140" y1="208" x2="250" y2="208"/>
    <line class="k" style="stroke:var(--ill-c2);stroke-width:9" x1="272" y1="208" x2="420" y2="208"/>
    <line class="k" style="stroke-width:9" x1="180" y1="253" x2="330" y2="253"/>
    <line class="k" style="stroke:var(--ill-c1);stroke-width:9" x1="352" y1="253" x2="410" y2="253"/>
    <line class="k" style="stroke-width:9" x1="180" y1="298" x2="280" y2="298"/>
    <line class="k" style="stroke:var(--ill-c3);stroke-width:9" x1="302" y1="298" x2="470" y2="298"/>
    <line class="k" style="stroke-width:9" x1="140" y1="343" x2="200" y2="343"/>
    <rect class="c1" x="216" y="325" width="22" height="36" rx="3"/>
    <rect class="c2" x="568" y="186" width="160" height="266" rx="30"/>
    <rect class="p" x="552" y="170" width="160" height="266" rx="30"/>
    <rect class="ink" x="607" y="186" width="50" height="14" rx="7"/>
    <rect class="kf c6" style="stroke-width:5" x="574" y="218" width="116" height="44" rx="10"/>
    <path class="k" style="stroke-width:6" d="M614 330 v-14 a18 18 0 0 1 36 0 v14"/>
    <rect class="kf c1" style="stroke-width:6" x="603" y="328" width="58" height="46" rx="9"/>
    <circle class="ink" cx="632" cy="349" r="5"/>
    <line class="k" style="stroke-width:5;opacity:.45" x1="596" y1="408" x2="668" y2="408"/>
    <path class="kb" d="M748 70 L718 100 L748 130"/>
    <path class="kb" d="M792 56 L772 144"/>
    <path class="kb" d="M816 70 L846 100 L816 130"/>
    ${spark(760, 214, 16)}
  `);

  // Before every merge: The Panel. Five reviewers, one diff, a gate that fails closed.
  ILL.panel = svg(`
    <rect class="c4" x="300" y="178" width="320" height="262" rx="22"/>
    <rect class="p" x="280" y="160" width="320" height="262" rx="22"/>
    <rect class="c3s" x="294" y="228" width="292" height="30" rx="6"/>
    <rect class="c1s" x="294" y="308" width="292" height="30" rx="6"/>
    <rect class="c3s" x="294" y="348" width="292" height="30" rx="6"/>
    <line class="k" style="stroke-width:7" x1="330" y1="203" x2="470" y2="203"/>
    <path class="k" style="stroke:var(--ill-c3);stroke-width:5" d="M298 243 h16 M306 235 v16"/>
    <line class="k" style="stroke-width:7" x1="330" y1="243" x2="540" y2="243"/>
    <line class="k" style="stroke-width:7" x1="330" y1="283" x2="500" y2="283"/>
    <path class="k" style="stroke:var(--ill-c1);stroke-width:5" d="M298 323 h16"/>
    <line class="k" style="stroke-width:7" x1="330" y1="323" x2="455" y2="323"/>
    <path class="k" style="stroke:var(--ill-c3);stroke-width:5" d="M298 363 h16 M306 355 v16"/>
    <line class="k" style="stroke-width:7" x1="330" y1="363" x2="560" y2="363"/>
    <line class="k" style="stroke-width:7" x1="330" y1="400" x2="420" y2="400"/>
    ${reviewer(150, 222, 'c2', 440, 300)}
    ${reviewer(252, 108, 'c3', 440, 300)}
    ${reviewer(440, 64, 'c1', 440, 300)}
    ${reviewer(628, 108, 'c5', 440, 300)}
    ${reviewer(730, 222, 'c4', 440, 300)}
    <path class="kb" d="M726 352 v-20 a28 28 0 0 1 56 0 v20"/>
    <rect class="kf c1" x="710" y="350" width="88" height="74" rx="13"/>
    <circle class="ink" cx="754" cy="380" r="8"/>
    <rect class="ink" x="750" y="384" width="8" height="18" rx="3"/>
    ${spark(120, 380, 16)}${spark(180, 420, 9)}
  `);

  // TUE: a recorded call becomes a priced, signed proposal.
  ILL.proposal = svg(`
    <g transform="translate(16 16)">${bubble(80, 70, 250, 190, 38, 'bottom', 146, 118, 318, 'c3')}</g>
    ${bubble(80, 70, 250, 190, 38, 'bottom', 146, 118, 318, 'p')}
    <circle class="kf c1" style="stroke-width:5" cx="294" cy="104" r="11"/>
    ${[40, 72, 104, 58, 120, 84, 46, 98, 62, 80, 36].map((h, i) =>
      `<line class="k" style="stroke-width:8${i === 4 || i === 7 ? ';stroke:var(--ill-c1)' : ''}" x1="${118 + i * 17}" y1="${170 - h / 2}" x2="${118 + i * 17}" y2="${170 + h / 2}"/>`).join('')}
    <path class="kb" d="M352 214 C 408 168, 452 262, 506 222"/>
    <path class="kb" d="M486 206 L508 221 L484 238"/>
    <rect class="c3" x="550" y="48" width="250" height="390" rx="20"/>
    <rect class="p" x="530" y="30" width="250" height="390" rx="20"/>
    <line class="k" style="stroke-width:11" x1="565" y1="84" x2="700" y2="84"/>
    <line class="k" style="stroke-width:6" x1="565" y1="130" x2="745" y2="130"/>
    <line class="k" style="stroke-width:6" x1="565" y1="164" x2="722" y2="164"/>
    <line class="k" style="stroke-width:6" x1="565" y1="198" x2="736" y2="198"/>
    <rect class="kf c6" style="stroke-width:5" x="565" y="230" width="180" height="60" rx="12"/>
    <line class="k" style="stroke-width:9" x1="587" y1="260" x2="690" y2="260"/>
    <path class="k" style="stroke-width:5" d="M572 362 c 16 -38, 34 26, 48 -6 s 24 -30, 36 4 s 30 12, 46 -14"/>
    <line class="k" style="stroke-width:4;opacity:.45" x1="565" y1="386" x2="745" y2="386"/>
    <g transform="rotate(-38 772 372)">
      <rect class="kf c1" x="660" y="357" width="188" height="30" rx="8"/>
      <path class="p" d="M660 357 L624 372 L660 387 Z"/>
      <circle class="ink" cx="632" cy="372" r="4"/>
      <line class="k" style="stroke-width:5" x1="812" y1="357" x2="812" y2="387"/>
    </g>
    ${spark(420, 100, 16)}
  `);

  // WED: the law, verbatim, with its citation.
  ILL.tax = svg(`
    <path class="kf c1" d="M440 170 C 360 138, 240 138, 128 160 L128 430 C 240 410, 360 410, 440 440 C 520 410, 640 410, 752 430 L752 160 C 640 138, 520 138, 440 170 Z"/>
    <path class="p" d="M440 152 C 360 120, 250 120, 150 142 L150 408 C 250 388, 360 388, 440 418 Z"/>
    <path class="p" d="M440 152 C 520 120, 630 120, 730 142 L730 408 C 630 388, 520 388, 440 418 Z"/>
    <text class="ink t-serif" x="182" y="226" font-size="84">§</text>
    <line class="k" style="stroke-width:6" x1="246" y1="200" x2="400" y2="194"/>
    <line class="k" style="stroke-width:6" x1="246" y1="232" x2="380" y2="228"/>
    <line class="k" style="stroke-width:6" x1="186" y1="276" x2="404" y2="270"/>
    <line class="k" style="stroke-width:6" x1="186" y1="310" x2="392" y2="306"/>
    <line class="k" style="stroke-width:6" x1="186" y1="344" x2="408" y2="342"/>
    <rect class="c5" style="opacity:.75" x="470" y="254" width="224" height="30" rx="7"/>
    <line class="k" style="stroke-width:6" x1="478" y1="200" x2="690" y2="196"/>
    <line class="k" style="stroke-width:6" x1="478" y1="234" x2="668" y2="232"/>
    <line class="k" style="stroke-width:6" x1="478" y1="269" x2="686" y2="269"/>
    <line class="k" style="stroke-width:6" x1="478" y1="304" x2="650" y2="306"/>
    <line class="k" style="stroke-width:6" x1="478" y1="339" x2="676" y2="342"/>
    <path class="kf c1" d="M596 128 L596 238 L614 222 L632 238 L632 126 Z"/>
    <g transform="rotate(7 726 88)">
      <rect class="p" x="624" y="24" width="210" height="124" rx="16"/>
      <text class="t-serif" style="fill:var(--ill-c1)" x="640" y="122" font-size="120">“</text>
      <line class="k" style="stroke-width:6" x1="702" y1="66" x2="808" y2="66"/>
      <line class="k" style="stroke-width:6" x1="702" y1="98" x2="784" y2="98"/>
    </g>
    <circle class="kf c3" cx="818" cy="150" r="31"/>
    <path class="k" style="stroke:var(--ill-paper);stroke-width:7" d="M803 150 l10 10 l19 -21"/>
    ${spark(96, 110, 18)}${spark(820, 300, 12)}
  `);

  // THU: one podcast episode becomes clips, posts and a newsletter.
  ILL.content = svg(`
    <rect class="c2" x="166" y="62" width="110" height="190" rx="55"/>
    <rect class="p" x="150" y="46" width="110" height="190" rx="55"/>
    <line class="k" style="stroke-width:5" x1="172" y1="84" x2="238" y2="84"/>
    <line class="k" style="stroke-width:5" x1="168" y1="108" x2="242" y2="108"/>
    <line class="k" style="stroke-width:5" x1="168" y1="132" x2="242" y2="132"/>
    <rect class="kf c1" style="stroke-width:6" x="150" y="156" width="110" height="24"/>
    <path class="kb" d="M118 160 v26 a87 87 0 0 0 174 0 v-26"/>
    <line class="kb" x1="205" y1="274" x2="205" y2="360"/>
    <line class="kb" style="stroke-width:10" x1="146" y1="366" x2="264" y2="366"/>
    <path class="kb" style="stroke-width:6" d="M318 66 A130 130 0 0 1 318 214"/>
    <path class="k" style="stroke-width:6;stroke:var(--ill-c1)" d="M348 44 A166 166 0 0 1 348 236"/>
    <g transform="rotate(-13 610 260)"><rect class="kf c2" x="535" y="120" width="150" height="270" rx="24"/></g>
    <g transform="rotate(-2 610 260)"><rect class="kf c5" x="535" y="118" width="150" height="270" rx="24"/></g>
    <g transform="rotate(10 610 260)">
      <rect class="p" x="535" y="120" width="150" height="270" rx="24"/>
      <circle class="kf c1" cx="610" cy="232" r="36"/>
      <path class="p" style="stroke-width:5" d="M598 214 L630 232 L598 250 Z"/>
      <line class="k" style="stroke-width:6" x1="560" y1="310" x2="660" y2="310"/>
      <line class="k" style="stroke-width:6" x1="560" y1="340" x2="630" y2="340"/>
    </g>
    <rect class="p" x="724" y="46" width="124" height="86" rx="12"/>
    <path class="k" style="stroke-width:6" d="M730 54 L786 96 L842 54"/>
    <circle class="kf c1" style="stroke-width:5" cx="848" cy="46" r="15"/>
    ${spark(452, 382, 16)}${spark(800, 250, 11)}
  `);

  // FRI: The Boardroom. Four advisors, four different answers.
  ILL.board = svg(`
    <ellipse class="kf c5" cx="440" cy="292" rx="196" ry="106"/>
    <ellipse class="kf c5" cx="440" cy="272" rx="196" ry="106"/>
    <ellipse class="c6" style="opacity:.8" cx="440" cy="266" rx="148" ry="72"/>
    ${bubble(84, 30, 188, 118, 34, 'bottom', 214, 262, 190, 'kf c2')}
    <path class="k" style="stroke-width:9" d="M150 90 l20 20 l38 -42"/>
    ${bubble(608, 30, 188, 118, 34, 'bottom', 666, 618, 190, 'kf c1')}
    <path class="k" style="stroke-width:9" d="M676 64 l40 40 M716 64 l-40 40"/>
    ${bubble(64, 318, 188, 118, 34, 'top', 196, 248, 262, 'kf c3')}
    <text class="ink t-serif" x="158" y="414" font-size="96" font-weight="700" text-anchor="middle">?</text>
    ${bubble(628, 318, 188, 118, 34, 'top', 684, 634, 262, 'kf c4')}
    <path class="k" style="stroke-width:6" d="M698 346 h44 M698 410 h44 M703 346 c0 22, 34 22, 34 32 c0 10, -34 10, -34 32 M737 346 c0 22, -34 22, -34 32 c0 10, 34 10, 34 32"/>
    ${spark(440, 118, 20)}${spark(392, 150, 10)}${spark(490, 150, 10)}
  `);

  // Month end: the status nobody checks.
  ILL.absence = svg(`
    <rect class="c2" x="152" y="50" width="520" height="360" rx="26"/>
    <rect class="p" x="130" y="30" width="520" height="360" rx="26"/>
    <line class="k" x1="130" y1="88" x2="650" y2="88"/>
    <circle class="kf c6" style="stroke-width:4" cx="168" cy="59" r="10"/>
    <circle class="kf c6" style="stroke-width:4" cx="200" cy="59" r="10"/>
    <circle class="kf c6" style="stroke-width:4" cx="232" cy="59" r="10"/>
    ${[[140, 'c3', 400], [205, 'c3', 360], [270, 'c1', 380], [335, 'c3', 340]].map(([y, c, len]) =>
      `<circle class="kf ${c}" style="stroke-width:5" cx="182" cy="${y}" r="16"/>` +
      `<line class="k" style="stroke-width:8" x1="218" y1="${y}" x2="${len}" y2="${y}"/>`).join('')}
    <rect class="c3s" x="468" y="120" width="130" height="40" rx="20"/>
    <text class="ink t-mono" x="533" y="148" font-size="24" text-anchor="middle">OK</text>
    <rect class="c3s" x="468" y="185" width="130" height="40" rx="20"/>
    <text class="ink t-mono" x="533" y="213" font-size="24" text-anchor="middle">OK</text>
    <rect class="kf c1" style="stroke-width:5" x="458" y="248" width="150" height="44" rx="22"/>
    <text class="t-mono" style="fill:var(--ill-ink)" x="533" y="279" font-size="24" font-weight="500" text-anchor="middle">ERROR</text>
    <rect class="c3s" x="468" y="315" width="130" height="40" rx="20"/>
    <text class="ink t-mono" x="533" y="343" font-size="24" text-anchor="middle">OK</text>
    <line class="k" style="stroke-width:22" x1="600" y1="330" x2="676" y2="414"/>
    <line class="k" style="stroke-width:22;stroke:var(--ill-c1)" x1="634" y1="368" x2="676" y2="414"/>
    <circle class="k" style="stroke-width:11;fill:rgba(255,255,255,.18)" cx="540" cy="270" r="84"/>
    <g transform="rotate(4 770 196)">
      <rect class="p" x="690" y="164" width="168" height="62" rx="16"/>
      <text class="ink t-mono" x="774" y="206" font-size="28" font-weight="500" text-anchor="middle">45 days</text>
    </g>
    <path class="kb" style="stroke-width:5;stroke-dasharray:2 12" d="M700 232 C 670 250, 650 250, 628 238"/>
    ${spark(86, 120, 16)}${spark(96, 330, 10)}
  `);

  window.ILL = ILL;
})();
