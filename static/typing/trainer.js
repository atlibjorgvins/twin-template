const PROMPTS = {
  easy: [
    "ég er glöð í dag",
    "hún á rauðan bíl",
    "við förum í skóla",
    "mamma bakar köku",
    "kötturinn sefur",
    "sólin skín úti",
    "ég borða epli",
    "hundurinn geltir",
    "við spilum saman",
    "pabbi les bók",
    "ís er góður",
    "fiskurinn syndir",
    "ég á systur",
    "blómin eru falleg",
    "snjór er hvítur",
    "góðan daginn",
    "takk fyrir mig",
    "vertu sæl",
    "halló vinur",
    "ég heiti anna",
    "hvað segirðu",
    "allt í lagi",
    "mér líður vel",
    "ég er svangur",
    "ég er þyrst",
    "mig langar í mjólk",
    "kakó er gott",
    "brauð með osti",
    "við eigum hund",
    "amma kemur í heimsókn",
    "afi er sterkur",
    "bróðir minn er stór",
    "litla systir hlær",
    "barnið grætur",
    "ég sofnaði fljótt",
    "vekjaraklukkan hringir",
    "ég bursta tennurnar",
    "ég klæði mig",
    "úlpan er hlý",
    "stígvélin eru blaut",
    "vettlingarnir týndust",
    "húfan er rauð",
    "trefillinn er mjúkur",
    "skólataskan er þung",
    "blýanturinn er beittur",
    "strokleðrið virkar vel",
    "ég les bókina",
    "við skrifum í stílabók",
    "kennarinn er góður",
    "í frímínútum hlaupum við",
    "boltinn rúllar burt",
    "stelpurnar hoppa í parís",
    "strákarnir spila fótbolta",
    "við förum í sund",
    "ég kann að synda",
    "vatnið er kalt",
    "pottar eru heitir",
    "við förum í bíó",
    "myndin var skemmtileg",
    "popp er nammi",
    "ég fór í afmæli",
    "afmælistertan var góð",
    "kertin loga",
    "ég fékk gjafir",
    "lego er gaman",
    "ég teikna mynd",
    "litirnir eru margir",
    "blár er minn litur",
    "grasið er grænt",
    "himinninn er blár",
    "skýin eru hvít",
    "regnboginn er fallegur",
    "það rignir mikið",
    "vindurinn blæs",
    "stormurinn er sterkur",
    "snjórinn fellur hægt",
    "við byggjum snjókall",
    "snjókast er sprell",
    "sleðinn rennur niður",
    "ég datt á svellinu",
    "það meiddi sig ekki",
    "mamma kyssir á bágt",
    "plástur læknar allt",
    "ég er orðin frísk",
    "við förum í göngutúr",
    "fuglar syngja á morgnana",
    "kýrnar baula",
    "hesturinn hleypur",
    "lambið er lítið",
    "kindin jarmar",
    "hænan verpir eggi",
    "haninn galar snemma",
    "býflugan suðar",
    "fiðrildi flýgur",
    "köngulóin spinnur vef",
    "maurarnir vinna hörðum höndum",
    "ég sé tunglið",
    "stjörnurnar tindra",
    "nóttin er löng",
    "draumar eru skrýtnir",
    "góða nótt mamma",
    "sofðu rótt",
    "sjáumst í fyrramálið",
    "ég elska þig"
  ],
  medium: [
    "Á sumrin förum við oft í sumarbústað og veiðum silung í vatninu.",
    "Það er gaman að ganga á fjöll þegar veðrið er gott og sólin skín.",
    "Reykjavík er höfuðborg Íslands og þar búa flestir landsmenn.",
    "Pabbi minn eldar besta fiskinn í heiminum á föstudagskvöldum.",
    "Þegar veturinn kemur fer snjórinn að falla yfir öll húsin.",
    "Ég les bækur á hverju kvöldi áður en ég fer að sofa.",
    "Hundurinn okkar heitir Skuggi og hann er svartur og loðinn.",
    "Á þriðjudögum förum við í sund og syndum margar ferðir.",
    "Það er kalt úti en heitt inni hjá ömmu og afa."
  ],
  hard: [
    "Þeir sem þora að þjást þora líka að þrá — þrautseigja er þögul þjálfun.",
    "Árið um kring eru íslensku árstíðirnar óútreiknanlegar; éljagangur, þíða og þoka skiptast á.",
    "Bóndinn á Þverá átti þrjátíu og þrjár ær, ellefu kýr og einn óþekkan hrút sem hét Skjöldur.",
    "Margt smátt gerir eitt stórt, sagði amma þegar hún saumaði saman bútasaumsteppið sitt.",
    "Hraðmæltir hraðritarar hrúga oft saman hröðum hljóðum án þess að hrasa á stafsetningunni.",
    "Á Þingvöllum mætast meginlandsflekarnir tveir og þar var Alþingi stofnað árið 930.",
    "Þótt þokan þéttist og þrumur þrumi þá þrjóskast þrastapariðir við að þagna."
  ]
};

const textEl = document.getElementById('text');
const inputEl = document.getElementById('input');
const wpmEl = document.getElementById('wpm');
const accEl = document.getElementById('acc');
const timeEl = document.getElementById('time');
const nextBtn = document.getElementById('next');
const restartBtn = document.getElementById('restart');
const resultEl = document.getElementById('result');
const rWpm = document.getElementById('r-wpm');
const rAcc = document.getElementById('r-acc');
const resultNext = document.getElementById('result-next');
const levelBtns = document.querySelectorAll('.level-btn');

let level = 'easy';
let target = '';
let startTime = null;
let timerId = null;
let totalKeystrokes = 0;
let errorCount = 0;

function pickPrompt() {
  const list = PROMPTS[level];
  return list[Math.floor(Math.random() * list.length)];
}

function renderText(typed) {
  let html = '';
  for (let i = 0; i < target.length; i++) {
    const ch = target[i];
    const display = ch === ' ' ? ' ' : ch;
    if (i < typed.length) {
      const cls = typed[i] === ch ? 'char--done' : 'char--wrong';
      html += `<span class="char ${cls}">${display}</span>`;
    } else if (i === typed.length) {
      html += `<span class="char char--current">${display}</span>`;
    } else {
      html += `<span class="char">${display}</span>`;
    }
  }
  textEl.innerHTML = html;
}

function updateStats() {
  if (!startTime) {
    wpmEl.textContent = '0';
    accEl.textContent = '100%';
    timeEl.textContent = '0s';
    return;
  }
  const elapsed = (Date.now() - startTime) / 1000;
  const typed = inputEl.value;
  const minutes = elapsed / 60;
  const words = typed.length / 5;
  const wpm = minutes > 0 ? Math.round(words / minutes) : 0;
  const acc = totalKeystrokes > 0
    ? Math.max(0, Math.round(((totalKeystrokes - errorCount) / totalKeystrokes) * 100))
    : 100;
  wpmEl.textContent = String(wpm);
  accEl.textContent = acc + '%';
  timeEl.textContent = Math.floor(elapsed) + 's';
}

function startTimer() {
  if (timerId) return;
  timerId = setInterval(updateStats, 200);
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function newPrompt() {
  resultEl.hidden = true;
  target = pickPrompt();
  inputEl.value = '';
  inputEl.disabled = false;
  startTime = null;
  totalKeystrokes = 0;
  errorCount = 0;
  stopTimer();
  updateStats();
  renderText('');
  inputEl.focus();
}

function finish() {
  stopTimer();
  inputEl.disabled = true;
  rWpm.textContent = wpmEl.textContent;
  rAcc.textContent = accEl.textContent;
  resultEl.hidden = false;
  resultNext.focus();
}

inputEl.addEventListener('input', (e) => {
  const typed = inputEl.value;
  if (!startTime && typed.length > 0) {
    startTime = Date.now();
    startTimer();
  }
  // count keystrokes & errors on insertion
  if (e.inputType && e.inputType.startsWith('insert')) {
    const i = typed.length - 1;
    if (i >= 0 && i < target.length) {
      totalKeystrokes++;
      if (typed[i] !== target[i]) errorCount++;
    }
  }
  renderText(typed);
  updateStats();
  if (typed === target) finish();
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (inputEl.value === target) {
      newPrompt();
    }
  }
});

nextBtn.addEventListener('click', newPrompt);
restartBtn.addEventListener('click', () => {
  inputEl.value = '';
  startTime = null;
  totalKeystrokes = 0;
  errorCount = 0;
  stopTimer();
  updateStats();
  renderText('');
  inputEl.focus();
});
resultNext.addEventListener('click', newPrompt);

levelBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    levelBtns.forEach((b) => b.setAttribute('aria-checked', 'false'));
    btn.setAttribute('aria-checked', 'true');
    level = btn.dataset.level;
    newPrompt();
  });
});

newPrompt();
