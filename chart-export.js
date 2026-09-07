/* 高清图表导出：独立画布复用原图表函数，不读取屏幕截图或重算模型。 */
(function (root) {
  "use strict";
  const ITEMS = Object.freeze([
    { id: "temperature", title: "仓顶温度曲线", unit: "温度 / ℃" },
    { id: "heat", title: "屋面累计传入热量", unit: "24小时净传入热量 / kWh（热量）" },
    { id: "devices", title: "全系统耗电构成", unit: "仓内制冷、风机与水泵 / kWh·日⁻¹" },
    { id: "total", title: "各工况日总耗电", unit: "日总耗电 / kWh" },
    { id: "saving", title: "相对原屋面净节能率", unit: "净节能率 / %；负值表示耗电增加" },
    { id: "fee", title: "各工况日运行费用", unit: "全系统电费 / 元·日⁻¹" },
    { id: "payback", title: "静态投资回收期", unit: "仅电费节约口径 / 年" },
    { id: "economic", title: "经济性汇总表", unit: "年净收益已扣除改造系统维护费" },
  ]);
  const W = 1000, CHART_H = 490, H = 690, SCALE = 2;
  const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  const f = (n, digits = 1) => Number(n).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  function economicTable(canvas, eco) {
    canvas.width = W * SCALE; canvas.height = CHART_H * SCALE;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    const pay = n => n == null ? "无正向收益" : `${f(n)} 年`;
    const rows = [
      ["经济指标", "双层通风屋面", "双层＋土壤源嵌管"],
      ["单位面积造价（元/㎡）", f(eco.cost_double_per), f(eco.cost_pipe_per)],
      ["总投资（元）", f(eco.invest_double, 0), f(eco.invest_pipe, 0)],
      ["单日电费节约（元/天）", f(eco.day_save_double, 2), f(eco.day_save_pipe, 2)],
      ["年毛节约电费（元）", f(eco.year_gross_double, 0), f(eco.year_gross_pipe, 0)],
      ["年度维护费率（%）", f(eco.maintain_rate_double), f(eco.maintain_rate_pipe)],
      ["年维护费（元）", f(eco.maintain_double, 0), f(eco.maintain_pipe, 0)],
      ["年净收益（元）", f(eco.year_net_double, 0), f(eco.year_net_pipe, 0)],
      ["静态投资回收期", pay(eco.payback_double), pay(eco.payback_pipe)],
    ];
    rows.forEach((row, i) => {
      const y = 20 + i * 49;
      ctx.fillStyle = i === 0 ? "#e4f1eb" : i % 2 ? "#ffffff" : "#f5f8f6";
      ctx.fillRect(24, y, W - 48, 49);
      ctx.font = `${i === 0 || i >= 7 ? "bold " : ""}15px ${FONT}`;
      ctx.textBaseline = "middle";
      row.forEach((text, col) => {
        ctx.textAlign = col === 0 ? "left" : "center";
        ctx.fillStyle = i >= 7 && col > 0 ? ((col === 1 ? eco.year_net_double : eco.year_net_pipe) > 0 ? "#127552" : "#b83c36") : "#263c34";
        ctx.fillText(text, [42, 530, 823][col], y + 24.5);
      });
    });
  }

  function draw(id, canvas, { snapshot, drawers, colors: C }) {
    const r = snapshot.result, e = snapshot.economic;
    const names = ["原屋面", "双层通风屋面", "双层＋嵌管"];
    const { lineChart, barChart, stackedBarChart } = drawers;
    switch (id) {
      case "temperature": return lineChart(canvas, [
        { values: r.res.T_amb, color: "#9aa7a2", dash: [6, 5], width: 1.5 },
        { values: r.res.base.T3, color: C.base, peakLabel: "原屋面" },
        { values: r.res.double.T3, color: C.double, peakLabel: "双层" },
        { values: r.res.pipe.T3, color: C.pipe, peakLabel: "嵌管" },
      ], r.res.hours);
      case "heat": return barChart(canvas, names, [r.Q_base_kwh, r.Q_double_kwh, r.Q_pipe_kwh], { digits: 0, allowNegative: true });
      case "devices": return stackedBarChart(canvas, names, [
        { label: "仓内制冷", color: C.purple, values: [r.E_cool_base_kwh, r.E_cool_double_kwh, r.E_cool_pipe_kwh] },
        { label: "风机", color: C.gold, values: [0, r.E_fan_kwh, r.E_fan3_kwh] },
        { label: "水泵", color: C.blue, values: [0, 0, r.E_pump_kwh] },
      ]);
      case "total": return barChart(canvas, names, [r.total_base_kwh, r.total_double_kwh, r.total_pipe_kwh]);
      case "saving": return barChart(canvas, names.slice(1), [r.rate_double, r.rate_pipe], { colors: [C.double, C.pipe], suffix: "%", allowNegative: true });
      case "fee": return barChart(canvas, names, [r.fee_base, r.fee_double, r.fee_pipe], { suffix: "元" });
      case "payback": return barChart(canvas, names.slice(1), [e.payback_double, e.payback_pipe], { colors: [C.double, C.pipe], suffix: "年" });
      case "economic": return economicTable(canvas, e);
      default: throw new Error("未找到所选图表");
    }
  }

  async function exportPng(id, options) {
    const item = ITEMS.find(x => x.id === id);
    if (!item || !options.snapshot.result) throw new Error("请先完成计算并选择图表");
    const plot = document.createElement("canvas"), image = document.createElement("canvas");
    try {
      plot.dataset.exportWidth = String(W); plot.dataset.exportHeight = String(CHART_H);
      draw(id, plot, options);
      image.width = W * SCALE; image.height = H * SCALE;
      const ctx = image.getContext("2d");
      if (!ctx) throw new Error("浏览器不支持图片绘制");
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#173e32"; ctx.font = `bold 24px ${FONT}`;
      ctx.fillText(`粮仓智改 · ${item.title}`, 28, 38);
      const p = options.snapshot.params;
      ctx.fillStyle = "#51665d"; ctx.font = `13px ${FONT}`;
      ctx.fillText(`屋面 ${f(p.A,0)}㎡  |  仓内空气 ${f(p.T_air_set)}℃  |  土壤源供水 ${f(p.T_water)}℃  |  制冷COP ${f(p.COP_ref)}  |  电价 ${f(p.price,2)}元/kWh`, 28, 66);
      ctx.fillText(item.unit, 28, 90);
      if (id === "temperature") {
        const labels = [["室外气温（虚线）", "#9aa7a2"], ["原屋面", options.colors.base], ["双层通风屋面", options.colors.double], ["双层＋土壤源嵌管", options.colors.pipe]];
        let x = 450;
        labels.forEach(([name,color]) => {
          ctx.fillStyle = color; ctx.fillRect(x,80,10,10);
          ctx.fillStyle = "#51665d"; ctx.fillText(name,x+15,90);
          x += ctx.measureText(name).width + 32;
        });
      }
      ctx.drawImage(plot, 0, 106, W, CHART_H);
      ctx.strokeStyle = "#dce7e1"; ctx.beginPath(); ctx.moveTo(28,612); ctx.lineTo(W-28,612); ctx.stroke();
      ctx.font = `12px ${FONT}`; ctx.fillStyle = "#61746c";
      const detail = id === "economic" || id === "payback"
        ? `年高温运行 ${f(p.hot_days_year,0)}天；完整改造系统维护费率：双层 ${f(p.maintain_rate_double)}%，双层＋嵌管 ${f(p.maintain_rate_pipe)}%。`
        : "三方案仓内空气采用同一控制温度；土壤源定温供水为假设，水泵与风机电耗已计入。";
      ctx.fillText(detail,28,634);
      ctx.fillText(id === "temperature" ? "仓顶为等效节点模拟温度，不是粮温或实测温度；沿用逐小时步结束温度记录。" : "简化模型估算结果，非实测或工程保证；年净收益为电费节约扣除维护费，不计利率与通胀。",28,655);
      const blob = await new Promise((resolve,reject) => image.toBlob(b => b ? resolve(b) : reject(new Error("PNG生成失败")), "image/png"));
      return blob;
    } finally {
      // 及时释放高分辨率画布，批量导出在手机上也不积累像素内存。
      plot.width = plot.height = image.width = image.height = 1;
    }
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const b of bytes) { crc ^= b; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // 无第三方网络依赖的ZIP Store打包；UTF-8标志使中文文件名正确解码。
  function zip(files) {
    const chunks = [], directory = []; let offset = 0, directorySize = 0;
    files.forEach(file => {
      const name = new TextEncoder().encode(file.name), data = file.data, crc = crc32(data);
      const header = new Uint8Array(30), h = new DataView(header.buffer);
      h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x800,true); h.setUint16(12,33,true);
      h.setUint32(14,crc,true); h.setUint32(18,data.length,true); h.setUint32(22,data.length,true); h.setUint16(26,name.length,true);
      chunks.push(header,name,data);
      const entry = new Uint8Array(46), e = new DataView(entry.buffer);
      e.setUint32(0,0x02014b50,true); e.setUint16(4,20,true); e.setUint16(6,20,true); e.setUint16(8,0x800,true); e.setUint16(14,33,true);
      e.setUint32(16,crc,true); e.setUint32(20,data.length,true); e.setUint32(24,data.length,true); e.setUint16(28,name.length,true); e.setUint32(42,offset,true);
      directory.push(entry,name); directorySize += 46+name.length; offset += 30+name.length+data.length;
    });
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true);
    e.setUint32(12,directorySize,true); e.setUint32(16,offset,true);
    return new Blob([...chunks,...directory,end],{type:"application/zip"});
  }

  async function exportZip(options, progress = () => {}) {
    const files = [];
    for (let i=0;i<ITEMS.length;i++) {
      const item = ITEMS[i]; progress(`正在生成 ${i+1}/${ITEMS.length}：${item.title}`);
      const blob = await exportPng(item.id,options);
      files.push({name:`${String(i+1).padStart(2,"0")}_${item.title}.png`,data:new Uint8Array(await blob.arrayBuffer())});
    }
    return zip(files);
  }

  root.GranaryChartExport = Object.freeze({ ITEMS, exportPng, exportZip });
})(typeof globalThis !== "undefined" ? globalThis : this);
