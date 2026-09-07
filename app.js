(function () {
  "use strict";

  const M = window.GranaryModel;
  const COLORS = {
    base: "#dc685c", double: "#2f76d2", pipe: "#1f9d72",
    purple: "#7758bb", gold: "#d99b32", grid: "#e4ece9", text: "#6f807a",
  };

  const FIELD_GROUPS = {
    basic: [
      ["A", "屋面面积", "m²", "1000"],
      ["U_roof", "原屋面传热系数", "W/m²·K", "1.2"],
      ["h_layer", "空气层高度", "m", "0.3"],
      ["Vdot", "通风量", "m³/h", "30000"],
    ],
    advanced: [
      ["T_water", "土壤源供水温度", "℃", "17"],
      ["P_pump", "嵌管循环水泵功率", "W", "2200"],
      ["T_air_set", "仓内空气控制温度", "℃", "23"],
      ["T_setpoint", "嵌管开启阈值", "℃", "35"],
      ["COP_ref", "仓内制冷 COP", "—", "2.5"],
    ],
    economic: [
      ["cost_double_per", "双层通风单位造价", "元/㎡", "100"],
      ["cost_pipe_per", "双层＋土壤源嵌管整套造价", "元/㎡", "220"],
      ["hot_days_year", "年高温运行天数", "天", "90"],
      ["price", "电价", "元/kWh", "0.65"],
      ["maintain_rate_double", "双层改造系统年度维护费率", "%", "1.5"],
      ["maintain_rate_pipe", "双层＋土壤源嵌管改造系统年度维护费率", "%", "1.0"],
    ],
  };

  const PAGE_TITLES = {
    dashboard: "项目总览",
    parameters: "屋面参数设置",
    thermal: "热工分析",
    energy: "能耗分析",
    economics: "经济性分析",
    report: "报告与导出",
  };
  const RESULT_PAGES = new Set(["thermal", "energy", "economics"]);

  let params = { ...M.DEFAULT_PARAMS };
  let result = null;
  let economic = null;
  let conclusion = "";
  let currentPage = "dashboard";
  let installPrompt = null;
  let toastTimer = null;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const fmt = (value, digits = 1) => Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const money = (value, digits = 0) => `${fmt(value, digits)} 元`;
  const energyRateLabel = value => value >= 0
    ? `节电 ${fmt(value)}%` : `耗电增加 ${fmt(Math.abs(value))}%`;

  function createFields(containerId, fields) {
    const container = document.getElementById(containerId);
    container.innerHTML = fields.map(([key, label, unit, placeholder]) => `
      <div class="field">
        <label for="field-${key}">${label}<span>${key}</span></label>
        <div class="input-wrap">
          <input id="field-${key}" name="${key}" type="number" step="any" inputmode="decimal"
                 value="${params[key]}" placeholder="${placeholder}" autocomplete="off">
          <span class="input-unit">${unit}</span>
        </div>
        <div class="field-error" id="error-${key}"></div>
      </div>`).join("");
  }

  function buildForm() {
    createFields("basicFields", FIELD_GROUPS.basic);
    createFields("advancedFields", FIELD_GROUPS.advanced);
    createFields("economicFields", FIELD_GROUPS.economic);
  }

  function syncFormFromParams() {
    Object.entries(params).forEach(([key, value]) => {
      const input = document.getElementById(`field-${key}`);
      if (input) input.value = value;
    });
    $$(".field-error").forEach(el => { el.textContent = ""; });
  }

  function readForm() {
    const next = { ...M.DEFAULT_PARAMS };
    let valid = true;
    [...FIELD_GROUPS.basic, ...FIELD_GROUPS.advanced, ...FIELD_GROUPS.economic]
      .forEach(([key]) => {
        const input = document.getElementById(`field-${key}`);
        const error = document.getElementById(`error-${key}`);
        const value = Number(input.value);
        error.textContent = "";
        input.removeAttribute("aria-invalid");
        if (input.value.trim() === "" || !Number.isFinite(value)) {
          valid = false;
          error.textContent = "请输入有效数字";
          input.setAttribute("aria-invalid", "true");
        } else {
          next[key] = value;
        }
      });

    const checks = [
      ["A", next.A > 0, "屋面面积必须大于0"],
      ["U_roof", next.U_roof > 0, "传热系数必须大于0"],
      ["Vdot", next.Vdot >= 0, "通风量不能为负"],
      ["P_pump", next.P_pump >= 0, "水泵功率不能为负"],
      ["T_air_set", next.T_air_set >= 10 && next.T_air_set <= 30, "仓内控制温度范围10～30℃"],
      ["price", next.price >= 0, "电价不能为负"],
      ["cost_double_per", next.cost_double_per >= 0, "造价不能为负"],
      ["cost_pipe_per", next.cost_pipe_per >= 0, "造价不能为负"],
      ["COP_ref", next.COP_ref > 0, "COP必须大于0"],
      ["h_layer", next.h_layer >= 0.05, "空气层高度建议不小于0.05m"],
      ["hot_days_year", next.hot_days_year >= 0 && next.hot_days_year <= 365, "年运行天数范围0～365"],
      ["maintain_rate_double", next.maintain_rate_double >= 0, "维护费率不能为负"],
      ["maintain_rate_pipe", next.maintain_rate_pipe >= 0, "维护费率不能为负"],
    ];
    checks.forEach(([key, ok, message]) => {
      if (!ok) {
        valid = false;
        const error = document.getElementById(`error-${key}`);
        const input = document.getElementById(`field-${key}`);
        if (error) error.textContent = message;
        if (input) input.setAttribute("aria-invalid", "true");
      }
    });
    if (!valid) throw new Error("请检查标红的模型参数");
    return next;
  }

  function calculate(nextParams = params, announce = false) {
    const next = { ...M.DEFAULT_PARAMS, ...nextParams };
    const nextResult = M.simulate(next);
    const nextEconomic = M.evaluateEconomic(next, nextResult);
    if (Object.values(nextResult).some(v => typeof v === "number" && !Number.isFinite(v)) ||
        Object.values(nextEconomic).some(v => typeof v === "number" && !Number.isFinite(v))) {
      throw new Error("参数导致计算超出有效范围，请调整后重试");
    }
    params = next;
    result = nextResult;
    economic = nextEconomic;
    conclusion = M.makeConclusion(result, economic, params);
    renderData();
    renderPageCharts(currentPage);
    if (announce) showToast("计算完成，全部图表与经济性结果已更新");
  }

  function renderData() {
    $("#kpiPeak").textContent = `${fmt(result.peak_base)} ℃`;
    $("#kpiPeakNote").textContent = `双层后 ${fmt(result.peak_double)} ℃`;
    $("#kpiReduction").textContent = `${fmt(result.red_double)} ℃`;
    $("#kpiEnergy").textContent = `${fmt(result.total_double_kwh)} kWh`;
    $("#kpiEnergyNote").textContent = `原屋面 ${fmt(result.total_base_kwh)} kWh`;
    $("#kpiFee").textContent = money(result.fee_double, 1);
    $("#kpiFeeNote").textContent = `原屋面 ${money(result.fee_base, 1)}`;
    $("#currentConditions").textContent = `三方案仓内空气均为 ${fmt(params.T_air_set)}℃ · 土壤源供水 ${fmt(params.T_water)}℃ · 仓内制冷 COP ${fmt(params.COP_ref)}`;

    const doubleBetter = result.rate_double > 0;
    $("#recommendTitle").textContent = doubleBetter ? "优先采用双层通风屋面" : "建议复核通风参数";
    $("#recommendText").textContent = doubleBetter
      ? `双层通风方案将仓顶峰值降低 ${fmt(result.red_double)}℃，日耗电减少 ${fmt(result.save_double)} kWh；嵌管组合${result.total_pipe_kwh < result.total_double_kwh ? "进一步节电，仍需核对新增投资与维护费。" : "未进一步节电，需结合仓顶削峰效果判断用途。"}`
      : "当前参数下双层方案未降低全系统耗电，建议优化通风量和运行时段。";
    $("#recommendRate").textContent = `${fmt(result.rate_double)}%`;
    $("#recommendRate").className = result.rate_double >= 0 ? "value-positive" : "value-negative";
    $("#recommendPayback").textContent = economic.payback_double == null ? "无正收益" : `${fmt(economic.payback_double)} 年`;

    $("#thermalTable").innerHTML = [
      ["原普通屋面", COLORS.base, result.peak_base, 0, result.Q_base_kwh, "对照基准"],
      ["双层通风屋面", COLORS.double, result.peak_double, result.red_double, result.Q_double_kwh, "隔热与定时通风"],
      ["双层＋土壤源嵌管", COLORS.pipe, result.peak_pipe, result.red_pipe, result.Q_pipe_kwh, "阈值控制辅助削峰"],
    ].map(([name, color, peak, reduction, heat, role]) => `
      <tr><td><span class="scheme-label" style="--scheme-color:${color}">${name}</span></td>
      <td>${fmt(peak)} ℃</td><td class="${reduction > 0 ? "value-positive" : ""}">${reduction > 0 ? `-${fmt(reduction)} ℃` : "—"}</td>
      <td>${fmt(heat, 0)} kWh</td><td>${role}</td></tr>`).join("");

    $("#energyCards").innerHTML = [
      ["原屋面日总耗电", result.total_base_kwh, "coral", `仓内制冷 ${fmt(result.E_cool_base_kwh)} kWh`],
      ["双层通风日总耗电", result.total_double_kwh, "blue", `${energyRateLabel(result.rate_double)} · 风机 ${fmt(result.E_fan_kwh)} kWh`],
      ["双层＋嵌管日总耗电", result.total_pipe_kwh, "green", `${energyRateLabel(result.rate_pipe)} · 屋面设备 ${fmt(result.E_pipe_kwh)} kWh`],
    ].map(([label, value, color, note]) => `<article class="kpi-card"><span class="kpi-icon ${color}">ϟ</span><div><small>${label}</small><strong>${fmt(value)} kWh</strong><p>${note}</p></div></article>`).join("");

    const energyRows = [
      ["原普通屋面", COLORS.base, result.E_cool_base_kwh, 0, 0, 0, result.total_base_kwh, null],
      ["双层通风屋面", COLORS.double, result.E_cool_double_kwh, result.E_fan_kwh, 0, 0, result.total_double_kwh, result.rate_double],
      ["双层＋嵌管", COLORS.pipe, result.E_cool_pipe_kwh, result.E_fan3_kwh, result.E_pump_kwh, result.E_pipe_source_kwh, result.total_pipe_kwh, result.rate_pipe],
    ];
    $("#energyBreakdownTable").innerHTML = energyRows.map(([name, color, storeCooling, fan, pump, pipeSource, total, rate]) => {
      const rateClass = rate == null ? "" : (rate >= 0 ? "value-positive" : "value-negative");
      const rateLabel = rate == null ? "基准" : energyRateLabel(rate);
      return `<tr><td><span class="scheme-label" style="--scheme-color:${color}">${name}</span></td><td>${fmt(storeCooling)}</td><td>${fmt(fan)}</td><td>${fmt(pump)}</td><td>${fmt(pipeSource)}</td><td><strong>${fmt(total)}</strong></td><td class="${rateClass}">${rateLabel}</td></tr>`;
    }).join("");

    const economicCardData = [
      ["双层通风总投资", money(economic.invest_double), "blue", `${fmt(params.cost_double_per)} 元/㎡`],
      ["双层方案年净收益", money(economic.year_net_double), economic.year_net_double >= 0 ? "green" : "coral", `${fmt(params.hot_days_year, 0)}个高温日`],
      ["双层静态回收期", economic.payback_double == null ? "无正向收益" : `${fmt(economic.payback_double)} 年`, "gold", "不计利率与通胀"],
      ["嵌管静态回收期", economic.payback_pipe == null ? "无正向收益" : `${fmt(economic.payback_pipe)} 年`, economic.payback_pipe == null ? "coral" : "green", `投资 ${money(economic.invest_pipe)}`],
    ];
    $("#economicCards").innerHTML = economicCardData.map(([label, value, color, note]) => `<article class="kpi-card"><span class="kpi-icon ${color}">¥</span><div><small>${label}</small><strong>${value}</strong><p>${note}</p></div></article>`).join("");

    const ecoRows = [
      ["单位面积造价", `${fmt(economic.cost_double_per)} 元/㎡`, `${fmt(economic.cost_pipe_per)} 元/㎡`],
      ["计算总投资", money(economic.invest_double), money(economic.invest_pipe)],
      ["单日电费节约", money(economic.day_save_double, 2), money(economic.day_save_pipe, 2)],
      ["年毛节约电费", money(economic.year_gross_double), money(economic.year_gross_pipe)],
      ["年维护费用", money(economic.maintain_double), money(economic.maintain_pipe)],
      ["年度净收益", money(economic.year_net_double), money(economic.year_net_pipe)],
      ["静态回收期", economic.payback_double == null ? "无正向收益" : `${fmt(economic.payback_double)} 年`, economic.payback_pipe == null ? "无正向收益" : `${fmt(economic.payback_pipe)} 年`],
    ];
    $("#economicTable").innerHTML = ecoRows.map((row, index) => `<tr><td>${row[0]}</td><td class="${index >= 5 ? (economic.year_net_double > 0 ? "value-positive" : "value-negative") : ""}">${row[1]}</td><td class="${index >= 5 ? (economic.year_net_pipe > 0 ? "value-positive" : "value-negative") : ""}">${row[2]}</td></tr>`).join("");
    $("#economicSubtitle").textContent = `屋面 ${fmt(params.A, 0)}㎡ · 仓内空气 ${fmt(params.T_air_set)}℃ · 年高温 ${fmt(params.hot_days_year, 0)}天 · 双层维护 ${fmt(params.maintain_rate_double)}% / 双层＋土壤源嵌管维护 ${fmt(params.maintain_rate_pipe)}%（各按整套改造投资）`;
    $("#conclusionPreview").textContent = conclusion;
  }

  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, Math.floor(rect.width || canvas.parentElement.clientWidth || 600));
    const height = Math.max(250, Math.floor(rect.height || canvas.parentElement.clientHeight || 330));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '11px "Microsoft YaHei", sans-serif';
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return { ctx, width, height };
  }

  function roundedRect(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function axes(ctx, width, height, yMin, yMax, suffix = "", marginOverrides = {}) {
    const margin = { left: 48, right: 18, top: 24, bottom: 42, ...marginOverrides };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    ctx.strokeStyle = COLORS.grid; ctx.fillStyle = COLORS.text; ctx.lineWidth = 1;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i += 1) {
      const y = margin.top + plotH * i / 4;
      const value = yMax - (yMax - yMin) * i / 4;
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(width - margin.right, y); ctx.stroke();
      ctx.fillText(`${fmt(value, yMax < 20 ? 1 : 0)}${suffix}`, margin.left - 8, y);
    }
    return { margin, plotW, plotH, x: value => margin.left + value * plotW, y: value => margin.top + (yMax - value) / (yMax - yMin || 1) * plotH };
  }

  function lineChart(id, series, labels) {
    const canvas = document.getElementById(id);
    if (!canvas || canvas.offsetParent === null) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const values = series.flatMap(item => item.values);
    let yMin = Math.floor(Math.min(...values) / 5) * 5 - 2;
    let yMax = Math.ceil(Math.max(...values) / 5) * 5 + 2;
    const a = axes(ctx, width, height, yMin, yMax, "℃");
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = COLORS.text;
    labels.forEach((label, index) => {
      if (index % 3 === 0 || index === labels.length - 1) ctx.fillText(`${label}h`, a.margin.left + index / (labels.length - 1) * a.plotW, height - a.margin.bottom + 11);
    });
    series.forEach(item => {
      ctx.beginPath();
      item.values.forEach((value, index) => {
        const x = a.margin.left + index / (item.values.length - 1) * a.plotW;
        const y = a.y(value);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = item.color; ctx.lineWidth = item.width || 2.5; ctx.setLineDash(item.dash || []); ctx.stroke(); ctx.setLineDash([]);
    });
  }

  function barChart(id, categories, values, options = {}) {
    const canvas = document.getElementById(id);
    if (!canvas || canvas.offsetParent === null) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const numeric = values.map(value => value == null ? 0 : value);
    const yMin = options.allowNegative ? Math.min(0, ...numeric) * 1.15 : 0;
    const yMax = Math.max(1, ...numeric.map(Math.abs)) * 1.2;
    const a = axes(ctx, width, height, yMin, yMax, options.axisSuffix || "");
    const group = a.plotW / categories.length;
    const barW = Math.min(70, group * .5);
    const zeroY = a.y(0);
    categories.forEach((category, index) => {
      const value = numeric[index];
      const x = a.margin.left + group * index + (group - barW) / 2;
      const valueY = a.y(value);
      const y = Math.min(zeroY, valueY);
      const h = Math.max(2, Math.abs(zeroY - valueY));
      const palette = options.colors || [COLORS.base, COLORS.double, COLORS.pipe];
      const color = palette[index % palette.length];
      const gradient = ctx.createLinearGradient(0, y, 0, y + h);
      gradient.addColorStop(0, color); gradient.addColorStop(1, `${color}aa`);
      roundedRect(ctx, x, y, barW, h, 7); ctx.fillStyle = gradient; ctx.fill();
      ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = value < 0 ? COLORS.base : "#334a42"; ctx.font = 'bold 11px "Microsoft YaHei"';
      const label = values[index] == null ? "无正收益" : `${fmt(value, options.digits ?? 1)}${options.suffix || ""}`;
      ctx.fillText(label, x + barW / 2, value >= 0 ? y - 7 : y + h + 17);
      ctx.font = '10px "Microsoft YaHei"'; ctx.fillStyle = COLORS.text; ctx.textBaseline = "top";
      const short = category.length > 8 ? category.replace("屋面", "") : category;
      ctx.fillText(short, x + barW / 2, height - a.margin.bottom + 12);
    });
  }

  function stackedBarChart(id, categories, stacks) {
    const canvas = document.getElementById(id);
    if (!canvas || canvas.offsetParent === null) return;
    const { ctx, width, height } = setupCanvas(canvas);
    const totals = categories.map((_, i) => stacks.reduce((sum, stack) => sum + stack.values[i], 0));
    const maxTotal = Math.max(1, ...totals);
    const a = axes(ctx, width, height, 0, maxTotal * 1.25, "", { top: 50 });
    const group = a.plotW / categories.length;
    const barW = Math.min(68, group * .48);
    categories.forEach((category, index) => {
      const x = a.margin.left + group * index + (group - barW) / 2;
      let bottom = a.y(0);
      stacks.forEach(stack => {
        const value = stack.values[index];
        if (value <= 0) return;
        const h = a.plotH * value / (maxTotal * 1.25);
        ctx.fillStyle = stack.color;
        ctx.fillRect(x, bottom - h, barW, h);
        if (h >= 18) {
          ctx.fillStyle = stack.color === COLORS.gold ? "#4b3715" : "#ffffff";
          ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = 'bold 9px "Microsoft YaHei"';
          ctx.fillText(fmt(value), x + barW / 2, bottom - h / 2);
        }
        bottom -= h;
      });
      ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = "#334a42"; ctx.font = 'bold 11px "Microsoft YaHei"';
      ctx.fillText(`${fmt(totals[index])} kWh`, x + barW / 2, bottom - 7);
      ctx.font = '10px "Microsoft YaHei"'; ctx.fillStyle = COLORS.text; ctx.textBaseline = "top";
      ctx.fillText(category.replace("屋面", ""), x + barW / 2, height - a.margin.bottom + 12);
    });
    ctx.font = '10px "Microsoft YaHei"';
    let legendX = a.margin.left;
    let legendY = 10;
    stacks.forEach(stack => {
      const labelWidth = ctx.measureText(stack.label).width + 34;
      if (legendX + labelWidth > width - a.margin.right) { legendX = a.margin.left; legendY += 17; }
      ctx.fillStyle = stack.color; ctx.fillRect(legendX, legendY, 9, 9);
      ctx.fillStyle = COLORS.text; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(stack.label, legendX + 13, legendY + 5);
      legendX += labelWidth;
    });
  }

  function renderPageCharts(page) {
    requestAnimationFrame(() => {
      if (!result) return;
      if (page === "dashboard") {
        lineChart("overviewTempChart", [
          { values: result.res.T_amb, color: "#9aa7a2", dash: [6, 5], width: 1.5 },
          { values: result.res.base.T3, color: COLORS.base },
          { values: result.res.double.T3, color: COLORS.double },
          { values: result.res.pipe.T3, color: COLORS.pipe },
        ], result.res.hours);
      }
      if (page === "thermal") {
        lineChart("temperatureChart", [
          { values: result.res.T_amb, color: "#9aa7a2", dash: [6, 5], width: 1.5 },
          { values: result.res.base.T3, color: COLORS.base },
          { values: result.res.double.T3, color: COLORS.double },
          { values: result.res.pipe.T3, color: COLORS.pipe },
        ], result.res.hours);
        barChart("heatChart", ["原屋面", "双层通风屋面", "双层＋嵌管"], [result.Q_base_kwh, result.Q_double_kwh, result.Q_pipe_kwh], { suffix: "", digits: 0, allowNegative: true });
      }
      if (page === "energy") {
        stackedBarChart("deviceEnergyChart", ["原屋面", "双层通风屋面", "双层＋嵌管"], [
          { label: "仓内制冷", color: COLORS.purple, values: [result.E_cool_base_kwh, result.E_cool_double_kwh, result.E_cool_pipe_kwh] },
          { label: "风机", color: COLORS.gold, values: [0, result.E_fan_kwh, result.E_fan3_kwh] },
          { label: "水泵", color: COLORS.blue, values: [0, 0, result.E_pump_kwh] },
        ]);
        barChart("totalEnergyChart", ["原屋面", "双层通风屋面", "双层＋嵌管"], [result.total_base_kwh, result.total_double_kwh, result.total_pipe_kwh]);
        barChart("savingRateChart", ["双层通风屋面", "双层＋嵌管"], [result.rate_double, result.rate_pipe], { colors: [COLORS.double, COLORS.pipe], suffix: "%", allowNegative: true });
      }
      if (page === "economics") {
        barChart("feeChart", ["原屋面", "双层通风屋面", "双层＋嵌管"], [result.fee_base, result.fee_double, result.fee_pipe], { suffix: "元" });
        barChart("paybackChart", ["双层通风屋面", "双层＋嵌管"], [economic.payback_double, economic.payback_pipe], { colors: [COLORS.double, COLORS.pipe], suffix: "年" });
      }
    });
  }

  function setSidebarAnalysis(open) {
    $("#analysisToggle").setAttribute("aria-expanded", String(open));
    $("#analysisMenu").classList.toggle("open", open);
  }

  function setMobileAnalysis(open) {
    $("#mobileAnalysisToggle").setAttribute("aria-expanded", String(open));
    $("#mobileAnalysisMenu").hidden = !open;
  }

  function navigate(page) {
    if (!PAGE_TITLES[page]) return;
    currentPage = page;
    const isResultPage = RESULT_PAGES.has(page);
    $$(".page").forEach(el => el.classList.toggle("active", el.dataset.page === page));
    $$('[data-nav]').forEach(el => el.classList.toggle("active", el.dataset.nav === page));
    $("#analysisToggle").classList.toggle("active", isResultPage);
    $("#mobileAnalysisToggle").classList.toggle("active", isResultPage);
    if (isResultPage) setSidebarAnalysis(true);
    setMobileAnalysis(false);
    $("#pageTitle").textContent = PAGE_TITLES[page];
    window.scrollTo({ top: 0, behavior: "smooth" });
    renderPageCharts(page);
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function download(name, type, content) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function timestamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function exportCsv() {
    const header = ["时刻(h)", "室外气温(℃)", "太阳辐射(W/m²)", "原屋面温度(℃)", "双层屋面温度(℃)", "双层+嵌管温度(℃)", "原屋面传入热(W)", "双层传入热(W)", "嵌管方案传入热(W)", "嵌管冷量(W)"];
    const rows = result.res.hours.map(h => [h, result.res.T_amb[h].toFixed(2), result.res.G[h].toFixed(1), result.res.base.T3[h].toFixed(2), result.res.double.T3[h].toFixed(2), result.res.pipe.T3[h].toFixed(2), result.res.base.q_in[h].toFixed(1), result.res.double.q_in[h].toFixed(1), result.res.pipe.q_in[h].toFixed(1), result.res.pipe.q_pipe[h].toFixed(1)]);
    const csv = "\ufeff" + [header, ...rows].map(row => row.join(",")).join("\r\n");
    download(`${timestamp()}_逐时数据.csv`, "text/csv;charset=utf-8", csv);
    showToast("逐时数据 CSV 已生成");
  }

  function exportReport() {
    const paramLines = Object.entries(params).map(([key, value]) => `  ${key} = ${value}`).join("\n");
    download(`${timestamp()}_结果说明.txt`, "text/plain;charset=utf-8", `${conclusion}\n\n【本次输入参数】\n${paramLines}`);
    showToast("自动分析报告已生成");
  }

  function exportJson() {
    download(`${timestamp()}_模型快照.json`, "application/json;charset=utf-8", JSON.stringify({ params, result, economic, generatedAt: new Date().toISOString() }, null, 2));
    showToast("完整模型快照已生成");
  }

  function bindEvents() {
    $$('[data-nav]').forEach(el => el.addEventListener("click", event => {
      event.preventDefault(); navigate(el.dataset.nav);
    }));
    $("#analysisToggle").addEventListener("click", () => {
      setSidebarAnalysis($("#analysisToggle").getAttribute("aria-expanded") !== "true");
    });
    $("#mobileAnalysisToggle").addEventListener("click", () => {
      setMobileAnalysis($("#mobileAnalysisToggle").getAttribute("aria-expanded") !== "true");
    });
    $("#parameterForm").addEventListener("submit", event => {
      event.preventDefault();
      try {
        calculate(readForm(), true);
        navigate("dashboard");
      } catch (error) {
        showToast(error.message);
      }
    });
    ["#resetTopBtn", "#resetFormBtn"].forEach(selector => $(selector).addEventListener("click", () => {
      params = { ...M.DEFAULT_PARAMS }; syncFormFromParams(); calculate(params); showToast("已恢复默认参数");
    }));
    $("#calculateTopBtn").addEventListener("click", () => {
      try { calculate(readForm(), true); } catch (error) { navigate("parameters"); showToast(error.message); }
    });
    $("#exportCsvBtn").addEventListener("click", exportCsv);
    $("#exportReportBtn").addEventListener("click", exportReport);
    $("#exportJsonBtn").addEventListener("click", exportJson);
    $("#printBtn").addEventListener("click", () => window.print());
    $("#copyConclusionBtn").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(conclusion); showToast("自动结论已复制"); }
      catch (_) { showToast("浏览器未允许复制，请手动选择文本"); }
    });
    window.addEventListener("resize", debounce(() => renderPageCharts(currentPage), 160));
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault(); installPrompt = event; $("#installBtn").hidden = false;
    });
    $("#installBtn").addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("#installBtn").hidden = true;
    });
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
  }

  function registerServiceWorker() {
    // 预览时不缓存，避免审核期间看到旧结果；以后经审核部署HTTPS后仍支持PWA。
    if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !["localhost", "127.0.0.1"].includes(location.hostname)) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  function init() {
    buildForm(); bindEvents(); calculate(params); navigate("dashboard"); registerServiceWorker();
  }

  window.addEventListener("DOMContentLoaded", init);
})();

