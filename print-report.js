/* 独立打印文档：不打印被隐藏的应用页面，也不依赖屏幕上的 canvas。 */
(function (root) {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value, digits = 1) => Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });

  function buildHtml(snapshot, fields, items) {
    const r = snapshot.result, e = snapshot.economic;
    const row = cells => "<tr>" + cells.map(cell => "<td>" + escape(cell) + "</td>").join("") + "</tr>";
    const payback = value => value == null ? "无正向收益" : number(value) + " 年";
    const metrics = [
      ["仓顶模拟峰值 / ℃", number(r.peak_base), number(r.peak_double), number(r.peak_pipe)],
      ["日总耗电 / kWh", number(r.total_base_kwh), number(r.total_double_kwh), number(r.total_pipe_kwh)],
      ["日电费 / 元", number(r.fee_base, 2), number(r.fee_double, 2), number(r.fee_pipe, 2)],
      ["改造投资 / 元", "—", number(e.invest_double, 0), number(e.invest_pipe, 0)],
      ["年维护费 / 元", "—", number(e.maintain_double, 0), number(e.maintain_pipe, 0)],
      ["年净收益 / 元", "—", number(e.year_net_double, 0), number(e.year_net_pipe, 0)],
      ["静态投资回收期", "—", payback(e.payback_double), payback(e.payback_pipe)],
    ];
    const groups = [];
    for (let i = 0; i < items.length; i += 2) {
      groups.push('<section class="sheet chart-sheet"><h2>图表附件 · ' + (i / 2 + 1) + '</h2>' +
        items.slice(i, i + 2).map(item => '<figure><img id="chart-' + escape(item.id) +
          '" alt="' + escape(item.title) + '" width="2000" height="1380"></figure>').join("") + "</section>");
    }
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>粮仓智改－当前计算报告</title><style>' +
      '*{box-sizing:border-box}body{margin:0;color:#193b30;background:#eaf0ed;font:14px/1.55 "Microsoft YaHei","PingFang SC",sans-serif}' +
      '.toolbar{position:sticky;top:0;padding:12px 20px;background:#fff;border-bottom:1px solid #ccdcd3;display:flex;gap:16px;align-items:center;flex-wrap:wrap}' +
      'button{padding:10px 18px;background:#0c7159;color:white;border:0;border-radius:6px;font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:wait}' +
      '#status{flex:1;min-width:220px}.sheet{max-width:210mm;margin:20px auto;padding:12mm;background:white}' +
      'h1{font-size:24px;margin:0 0 8px}h2{font-size:17px;margin:14px 0 8px}.meta,.note{color:#536b60;font-size:12px}' +
      'table{border-collapse:collapse;width:100%;table-layout:fixed;margin:8px 0 14px;font-size:12px}th,td{border:1px solid #cad9d1;padding:6px 8px;overflow-wrap:anywhere;text-align:left}' +
      'th{background:#e9f3ed}.params td:first-child{width:65%}tr,figure{break-inside:avoid;page-break-inside:avoid}' +
      '.analysis p{white-space:pre-wrap;margin:0 0 8px;overflow-wrap:anywhere}.chart-sheet h2{margin:0 0 3mm}' +
      'figure{margin:0 auto 3mm;max-width:170mm}img{display:block;width:100%;height:auto}' +
      '@page{size:A4 portrait;margin:12mm}' +
      '@media print{html,body{background:white!important;margin:0!important;animation:none!important;color:#193b30}' +
      '.toolbar{display:none!important}.sheet{max-width:none;margin:0;padding:0;box-shadow:none}.sheet+.sheet{break-before:page;page-break-before:always}' +
      'thead{display:table-header-group}th,td{padding:3px 6px}img{max-width:170mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;animation:none!important;transition:none!important}}' +
      '@media screen and (max-width:600px){.sheet{padding:16px;margin:12px 0}th,td{padding:5px}}' +
      '</style></head><body><div class="toolbar"><button id="print-ready" disabled>打印 / 保存为 PDF</button>' +
      '<span id="status" role="status" aria-live="polite">正在生成完整报告，请稍候…</span></div>' +
      '<main><section class="sheet"><h1>粮仓智改 · 节能评估报告</h1><p class="meta">生成时间：' +
      escape(snapshot.generatedAt) + ' · 本报告使用点击打印时最后一次完成计算的结果</p>' +
      '<p>基于简化动态热阻一热容模型，在相同仓内空气控制温度下比较原屋面、双层通风屋面和双层＋土壤源嵌管。</p>' +
      '<h2>一、当前模型参数</h2><table class="params"><thead><tr><th>参数</th><th>数值</th></tr></thead><tbody>' +
      fields.map(([key, label, unit]) => row([label, snapshot.params[key] + " " + unit])).join("") +
      '</tbody></table><h2>二、主要结果</h2><table><thead><tr><th>指标</th><th>原屋面</th><th>双层通风屋面</th><th>双层＋嵌管</th></tr></thead><tbody>' +
      metrics.map(row).join("") + '</tbody></table><p class="note">年净收益＝单日电费节约×年运行天数－年维护费；回收期＝改造投资÷年净收益（仅净收益为正时）。不计利率、通胀、残值与粮食品质收益。原屋面为改造比较基准，“—”表示该项不作改造经济性计算。</p></section>' +
      '<section class="sheet analysis"><h2>三、自动分析与模型边界</h2>' +
      snapshot.conclusion.split("\n").filter(Boolean).map(line => "<p>" + escape(line) + "</p>").join("") +
      '</section>' + groups.join("") + '</main></body></html>';
  }

  function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("无法读取图表图片"));
      reader.onabort = () => reject(new Error("图表读取已取消"));
      reader.readAsDataURL(blob);
    });
  }

  function loadImage(image, source) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("图表加载超时，请重新生成报告")), 30000);
      function finish(error) {
        clearTimeout(timer); image.onload = image.onerror = null;
        error ? reject(error) : resolve();
      }
      image.onload = () => image.naturalWidth > 0 ? finish() : finish(new Error("图表内容为空"));
      image.onerror = () => finish(new Error("图表加载失败"));
      image.src = source;
    }).then(() => typeof image.decode === "function" ? image.decode() : undefined);
  }

  async function open(options, fields, onStatus = () => {}) {
    // 必须在用户点击的同步阶段打开，避免等待绘图后被浏览器当作弹窗拦截。
    const target = window.open("", "_blank");
    if (!target) throw new Error("浏览器拦截了报告窗口，请允许本站弹出窗口后重试");
    const snapshot = JSON.parse(JSON.stringify(options.snapshot));
    snapshot.generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    const api = root.GranaryChartExport;
    const doc = target.document;
    let printButton, status;
    try {
      doc.open(); doc.write(buildHtml(snapshot, fields, api.ITEMS)); doc.close();
      status = doc.getElementById("status"); printButton = doc.getElementById("print-ready");
      const update = message => { status.textContent = message; onStatus(message); };
      if (document.fonts?.ready) await document.fonts.ready;
      for (let i = 0; i < api.ITEMS.length; i++) {
        if (target.closed) throw new Error("报告窗口已关闭，请重新点击打印");
        const item = api.ITEMS[i];
        update("正在生成图表 " + (i + 1) + "/" + api.ITEMS.length + "：" + item.title);
        const blob = await api.exportPng(item.id, { ...options, snapshot });
        await loadImage(doc.getElementById("chart-" + item.id), await blobDataUrl(blob));
      }
      if (doc.fonts?.ready) await doc.fonts.ready;
      if (target.closed) throw new Error("报告窗口已关闭，请重新点击打印");
      // 不隐藏、不销毁文档；取消打印后仍可查看报告并再次打印。
      const print = () => {
        try { target.focus(); target.print(); }
        catch (_) { update("报告已就绪。请使用本窗口的浏览器菜单进行打印或保存 PDF。"); }
      };
      printButton.disabled = false;
      printButton.addEventListener("click", print);
      update("报告与8张图表已就绪。若未弹出打印面板，请点击左侧按钮；取消后也可再次打印。");
      // 图片已完成加载及解码，读取布局后才调用打印，不依赖页面切换动画。
      void doc.body.offsetHeight;
      print();
      return target;
    } catch (error) {
      if (!target.closed && status) status.textContent = "报告未生成完整，未执行打印：" + error.message + "。请返回原网页重试。";
      throw error;
    }
  }

  root.GranaryPrintReport = Object.freeze({ open, buildHtml });
})(typeof globalThis !== "undefined" ? globalThis : this);
