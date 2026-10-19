// The story, beat by beat. One list drives both the scrolling article and the video.
//
//   id       used by main.js to attach visuals to the beat
//   dur      seconds in the video (and the relative scroll length in the article)
//   caption  the on-screen line in the video; keep it short enough to read in `dur`
//   html     the article text for the beat
//   video    false to leave the beat out of the video (it stays in the article)
//
// Edit the words here; timings of the visuals are given as fractions of each beat in main.js.

export const TITLE = "The crevasses that shouldn't be there";
export const DEK =
  "Radar found what look like crevasses buried deep inside an Antarctic ice rise. They may record how the West Antarctic Ice Sheet shrank and then grew back after the last ice age. In 2027 the PHIRE expedition will drill into them.";

export const BEATS = [
  {
    id: "intro",
    dur: 5,
    caption: "Deep inside the Antarctic ice, our radar found something that shouldn't be there.",
    html: `<p>In January 2014 a small team towing an ice-penetrating radar across a remote dome of ice in the
      Weddell Sea saw something strange in the data: bright, steeply tilted echoes near the bottom of the ice,
      hundreds of metres beneath them.</p>
      <p>A decade later we think those echoes record how this part of Antarctica changed over the last
      12,000 years. This is how we found them, and why we are going back to drill into them.</p>`,
  },
  {
    id: "icesheet",
    dur: 5.5,
    caption: "West Antarctica's ice holds metres of sea-level rise. Where it meets the sea, it floats.",
    html: `<p>The West Antarctic Ice Sheet rests on a bed that lies mostly below sea level. Where its ice reaches
      the coast it lifts off the bed and floats, forming ice shelves. The <span class="key gl">grounding line</span>
      marks where the ice starts to float.</p>
      <p>To predict how fast the ice sheet could shrink as the climate warms, we need to know how it behaved in the
      past, especially during the warm millennia since the last ice age.</p>`,
  },
  {
    id: "hir",
    dur: 5.5,
    caption: "In the middle of the floating Ronne Ice Shelf sits Henry Ice Rise: an island of ice frozen to the seabed.",
    html: `<p>Ice from the heart of West Antarctica drains into the Ronne Ice Shelf, which flows at hundreds of metres
      a year (<span class="key speed">colour</span> shows today's speed).</p>
      <p>In the middle of the shelf sits <strong>Henry Ice Rise</strong>: 7,000&nbsp;km² of ice resting on the
      seabed, 300 to 800&nbsp;m below sea level. The shelf flows around it. The ice rise itself moves less than
      10&nbsp;m a year, and its base is frozen to the bed.</p>`,
  },
  {
    id: "season1",
    dur: 7,
    caption: "January 2014. We criss-crossed the ice rise with an ice-penetrating radar.",
    html: `<p>In the 2013/14 field season we surveyed the ice rise with DELORES, the British Antarctic Survey's
      deep-looking radio-echo sounder. It sends radio pulses down through the ice and records echoes from layers
      of buried snow and from the bed below.</p>
      <p>The <span class="key s1">lines</span> appear in the order we drove them, timed from the radar's own logs.</p>`,
  },
  {
    id: "discovery",
    dur: 6.5,
    caption: "On Line 3, the deepest ice lit up with something strange.",
    html: `<p>On 4 and 5 January we drove <strong>Line 3</strong>, 34&nbsp;km across the ice rise. Most of the
      radargram is calm: layers of old snowfall, bent by the slow flow of the ice, above the bright echo of the bed.</p>
      <p>But near both ends of the line the deepest ice is full of bright, tangled, steeply tilted echoes, rising
      from the bed into the ice above.</p>`,
  },
  {
    id: "mystery",
    dur: 5.5,
    caption: "They looked like crevasses. But crevasses don't form deep inside slow, frozen ice.",
    html: `<p>They looked like crevasses: cracks that open where ice is pulled apart, usually where it flows fast.</p>
      <p>Henry Ice Rise barely moves and is frozen to its bed. So what were crevasses doing hundreds of metres down
      inside it, and why only near the bottom, beneath smooth, unbroken layers?</p>`,
  },
  {
    id: "season2",
    dur: 6.5,
    caption: "December 2014. We came back to map them in detail.",
    html: `<p>We finished the 2013/14 survey, then came back the next summer. Over a week in December 2014 we drove a
      dense <span class="key s2">grid of lines</span> a few hundred metres apart over the northern end of the ice
      rise, where the bed is highest and the features come closest to the surface.</p>`,
  },
  {
    id: "fl5",
    dur: 6.5,
    caption: "Steep cracks, about 450 m apart, rising from the bed and capped by a smooth layer.",
    html: `<p>Processed to put each echo back where it came from, line FL5 (driven on 30 December) shows them clearly:
      steep reflectors that rise from the bed and stop beneath a smooth layer. Their mean spacing is about 450&nbsp;m.</p>`,
  },
  {
    id: "pattern",
    dur: 5,
    video: false,
    caption: "They lie under the northern tip and both flanks, but not down the middle.",
    html: `<p>Line by line, the survey shows where they are. The buried crevasses lie beneath the northern tip and along both
      flanks of the ice rise, but not in a band down its middle. The <span class="key onset">points</span> mark where
      they begin along each line, and the edges of the crevasse-free band follow faint
      <span class="key texture">changes in surface texture</span> that run parallel to today's grounding line.</p>`,
  },
  {
    id: "rumples",
    dur: 5.5,
    caption: "Cracks like these open today where floating ice runs aground.",
    html: `<p>We know where cracks like these form today. Where a floating ice shelf runs aground on a high in the seabed,
      it buckles and stretches and crevasses open, as they do at the nearby Doake Ice Rumples.</p>
      <p>This satellite image shows the same thing happening right now at the northern edge of Henry Ice Rise, a few
      kilometres from our survey: a field of crevasses about a kilometre across.</p>`,
  },
  {
    id: "hypothesis",
    dur: 5,
    caption: "Was Henry Ice Rise once afloat?",
    html: `<p>That suggests an explanation. Perhaps Henry Ice Rise was once part of the floating ice shelf. When the shelf
      ran aground on the seabed high beneath its northern end, it cracked like Doake Ice Rumples does today. Sea water
      filled the cracks and froze. The ice thickened, stopped flowing, froze to its bed, and centuries of snowfall
      buried the crevasses.</p>
      <p>If so, the grounding line was once far inland of where it is today.</p>`,
  },
  {
    id: "model",
    dur: 11,
    caption: "In a model, the ice retreats and Henry Ice Rise floats off. Then the rising seabed lets the ice run aground and grow back.",
    html: `<p>We explored this with an ice-sheet model (PISM; Kingslake et al., 2018). As the climate warms after the last
      ice age, the <span class="key model">modelled grounding line</span> retreats inland of its
      <span class="key gl">present position</span>, by up to 300&nbsp;km in places. In the Weddell Sea it is furthest
      inland about 10,200 years ago (<span class="key min">blue</span>), and Henry Ice Rise floats off its bed.</p>
      <p>Relieved of the weight of ice, the land rebounds and the seabed rises. The shelf runs aground on highs like the
      one beneath Henry Ice Rise, and the ice sheet grows back towards its present size. (At the model's 15&nbsp;km
      resolution only part of the ice rise regrounds.)</p>`,
  },
  {
    id: "stakes",
    dur: 5,
    caption: "If that happened, the solid Earth can stop and reverse ice-sheet retreat.",
    html: `<p>Two histories fit what we know. In one, the ice sheet shrank steadily to its present size and Henry Ice Rise
      simply slowed down. In the other, the ice sheet retreated much further and then <strong>re-advanced</strong>.</p>
      <p>The difference matters for the future. If rebound of the solid Earth halted the retreat, similar processes might
      slow future ice loss. If the climate drove it, this sector is sensitive to climate. Both histories can explain an
      ice rise that once flowed faster. Only re-advance predicts frozen sea water inside those crevasses.</p>`,
  },
  {
    id: "drillsite",
    dur: 6,
    caption: "In 2027, PHIRE will drill here.",
    html: `<p>So we are going to look. The first PHIRE drill site is on line FL5 at the northern end of Henry Ice Rise
      (79.90°&nbsp;S, 60.25°&nbsp;W), above the shallowest of the buried crevasses.</p>`,
  },
  {
    id: "block",
    dur: 8,
    caption: "450 m down, straight through the buried crevasses.",
    html: `<p>In the 2027/28 season a rapid-access drill will recover a continuous record of ice chips down to about
      450&nbsp;m, into the crevassed ice, which starts 400 to 450&nbsp;m below the surface here. A camera lowered into the
      hole will look for the blue streaks of refrozen sea water.</p>
      <p>The next season a hot-water drill will reach the bed to sample the sediment beneath, which would hold marine
      microfossils if the ocean was once there.</p>`,
  },
  {
    id: "temperature",
    dur: 7,
    caption: "Frozen sea water in the cracks would show it was afloat. The ice's temperature will show when.",
    html: `<p>A fibre-optic cable left in the hole will measure the temperature of the ice. When floating ice runs aground,
      the ocean stops warming its base and the ice cools from the bottom up, over thousands of years. The profile
      measured today still carries the signature of when that happened.</p>
      <p>The curves are from our model of a 500&nbsp;m column of ice
      <span class="key temp">after grounding</span>, with placeholder values for the site.</p>`,
  },
  {
    id: "end",
    dur: 5,
    caption: "PHIRE: the Henry Ice Rise Expedition. 2027–2029.",
    html: `<p>Frozen sea water in the crevasses would show that Henry Ice Rise was once afloat, and that the ice sheet
      retreated past it and grew back. The temperature of the ice, the age of the ice around the crevasses and the
      sediment beneath will tell us when, and help pin down why.</p>`,
  },
];
