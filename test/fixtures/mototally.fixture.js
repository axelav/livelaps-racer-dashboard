// 3 riders, checks: [timed, untimed(0), timed]. Winner row first (defines timed columns).
// Section times (seconds):        RaceTotal
//   A (AMA 111, AA): 120, 180  -> 300 (5:00)  EventPlace 1
//   B (AMA 222, AA):  60, 300  -> 360 (6:00)  EventPlace 2
//   C (AMA 333, B ): 180, 240  -> 420 (7:00)  EventPlace 3
export const MOTOTALLY_FIXTURE_HTML = `
<h1 id="mtR_h1RREventName">2026 Test Enduro</h1>
<select id="mtR_ddlSelectClass">
  <option value="O1">OVERALL Long Course</option>
  <option value="O2">OVERALL A</option>
  <option value="C8">A Senior 40+</option>
</select>
<table id="mtR_gvResults" cellspacing="1" border="0">
  <tr><td colspan="12">OVERALL Long Course - Check-by-Check Score by Place</td></tr>
  <tr><td>EventPlace</td><td>AMA#</td><td>Row</td><td>Rider Name</td><td>Club</td><td>Sponsors</td><td>Brand</td><td>Class</td><td>1</td><td>2</td><td>3</td><td>MaxChk</td><td>TotalTime</td></tr>
  <tr class="gvAR"><td>1</td><td>111</td><td>22A</td><td><a href='javascript:getRiderDetail(1);'>RIDER A</a></td><td>&nbsp;</td><td>&nbsp;</td><td><span class='bb Beta'>BET</span</td><td>AA</td><td>2:00<span style='font-size:6pt'> (2)</span></td><td>0</td><td>3:00<span style='font-size:6pt'> (1)</span></td><td>2</td><td>5:00</td></tr>
  <tr class="gvR"><td>2</td><td>222</td><td>18A</td><td><a href='javascript:getRiderDetail(2);'>RIDER B</a></td><td>&nbsp;</td><td>&nbsp;</td><td><span class='bb KTM'>KTM</span</td><td>AA</td><td>1:00<span style='font-size:6pt'> (1)</span></td><td>0</td><td>5:00<span style='font-size:6pt'> (3)</span></td><td>2</td><td>6:00</td></tr>
  <tr class="gvAR"><td>3</td><td>333</td><td>4B</td><td><a href='javascript:getRiderDetail(3);'>RIDER C</a></td><td>&nbsp;</td><td>&nbsp;</td><td><span class='bb Gas'>GAS</span</td><td>B</td><td>3:00<span style='font-size:6pt'> (3)</span></td><td>0</td><td>4:00<span style='font-size:6pt'> (2)</span></td><td>2</td><td>7:00</td></tr>
</table>`;

// Build a happy-dom Document from an HTML string (test helper).
export async function docFromHtml(html) {
  const { Window } = await import('happy-dom');
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}
