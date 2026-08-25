(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GranaryModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 与“软件8.24/粮仓智改10.py”保持一致的默认参数。
  const DEFAULT_PARAMS = Object.freeze({
    A: 1000.0,
    U_roof: 1.2,
    h_layer: 0.3,
    Vdot: 30000.0,
    T_water: 20.0,
    COP: 3.5,
    T_setpoint: 37.0,
    price: 0.6,
    COP_ref: 2.5,
    cost_double_per: 85.0,
    cost_pipe_per: 140.0,
    hot_days_year: 90.0,
    maintain_rate: 2.0,
    alpha: 0.7,
    Gmax: 850.0,
    h_ext: 15.0,
    ua_pipe: 2.5,
    fan_factor: 0.06,
    P_pump: 1500.0,
    fan_start: 9.0,
    fan_end: 18.0,
    rho_roof: 2400.0,
    cp_roof: 880.0,
    delta_roof: 0.12,
    bin_h: 4.0,
    UA_wall: 840.0,
    UA_grain: 500.0,
    T_grain: 28.0,
    T_air0: 28.0,
  });

  const HOURS = 24;
  const STEP = 3600.0;

  function zhengzhouWeather(hour) {
    // 保留 Python 原版公式，不在 Web 迁移中改变模型口径。
    const tmax = 38.0;
    const tmin = 26.0;
    const tvalley = 3.0;
    const temperature = (tmax + tmin) / 2.0
      + (tmax - tmin) / 2.0 * Math.sin(Math.PI * (hour - tvalley) / 12.0);
    let radiation = 0.0;
    if (hour >= 6.0 && hour <= 19.0) {
      radiation = 850.0 * Math.sin(Math.PI * (hour - 6.0) / 13.0);
    }
    return [temperature, radiation];
  }

  function uLayer(height) {
    return Math.max(6.0, 12.0 - 6.0 * height);
  }

  function emptyArray(value = 0.0) {
    return Array.from({ length: HOURS }, () => value);
  }

  function simulate(inputParams) {
    const p = { ...DEFAULT_PARAMS, ...inputParams };
    const A = p.A;
    const Uroof = p.U_roof;
    const Vdot = p.Vdot;
    const Twater = p.T_water;
    const COP = p.COP;
    const COPref = p.COP_ref;
    const alpha = p.alpha;
    const hext = p.h_ext;
    const uaPipe = p.ua_pipe;
    const setpoint = p.T_setpoint;

    const Croof = p.rho_roof * p.cp_roof * p.delta_roof * A;
    const Vbin = A * p.bin_h;
    const Cair = 1.2 * 1005.0 * Vbin;
    const vdotMs = Vdot / 3600.0 / A;
    const rhoCpAir = 1.2 * 1005.0;
    const Ulay = uLayer(p.h_layer);
    const Pfan = p.fan_factor * Vdot;

    const res = {
      hours: Array.from({ length: HOURS }, (_, i) => i),
      T_amb: emptyArray(),
      G: emptyArray(),
      base: { T3: emptyArray(), q_in: emptyArray() },
      double: {
        T3: emptyArray(), q_in: emptyArray(), T1: emptyArray(),
        T2: emptyArray(), fan_on: emptyArray(false),
      },
      pipe: {
        T3: emptyArray(), q_in: emptyArray(), q_pipe: emptyArray(),
        on: emptyArray(false), T1: emptyArray(), T2: emptyArray(),
      },
    };

    // 工况一：原普通屋面。
    let T3 = 32.0;
    let Tair = p.T_air0;
    let Qbase = 0.0;
    for (let h = 0; h < HOURS; h += 1) {
      const [Tamb, G] = zhengzhouWeather(h);
      res.T_amb[h] = Tamb;
      res.G[h] = G;
      const qSolar = alpha * G * A;
      const qExt = hext * A * (T3 - Tamb);
      const qIn = Uroof * A * (T3 - Tair);
      T3 += (qSolar - qExt - qIn) / Croof * STEP;
      Tair = (Uroof * A * T3 + p.UA_wall * Tamb + p.UA_grain * p.T_grain
        + Cair / STEP * Tair)
        / (Uroof * A + p.UA_wall + p.UA_grain + Cair / STEP);
      res.base.T3[h] = T3;
      res.base.q_in[h] = qIn;
      Qbase += qIn * STEP;
    }

    // 工况二：双层通风屋面。
    let T1 = 32.0;
    let T2 = 30.0;
    T3 = 32.0;
    Tair = p.T_air0;
    let Qdouble = 0.0;
    let Efan = 0.0;
    for (let h = 0; h < HOURS; h += 1) {
      const [Tamb, G] = zhengzhouWeather(h);
      const fanOn = p.fan_start <= h && h < p.fan_end;
      res.double.fan_on[h] = fanOn;
      T1 = (alpha * G + hext * Tamb + Ulay * T2) / (hext + Ulay);
      T2 = (Ulay * T1 + Ulay * T3 + rhoCpAir * vdotMs * Tamb)
        / (2.0 * Ulay + rhoCpAir * vdotMs);
      const qLayer = Ulay * A * (T2 - T3);
      const qIn = Uroof * A * (T3 - Tair);
      T3 += (qLayer - qIn) / Croof * STEP;
      Tair = (Uroof * A * T3 + p.UA_wall * Tamb + p.UA_grain * p.T_grain
        + Cair / STEP * Tair)
        / (Uroof * A + p.UA_wall + p.UA_grain + Cair / STEP);
      res.double.T1[h] = T1;
      res.double.T2[h] = T2;
      res.double.T3[h] = T3;
      res.double.q_in[h] = qIn;
      Qdouble += qIn * STEP;
      if (fanOn) Efan += Pfan;
    }

    // 工况三：双层屋面加嵌管辅助降温。
    T1 = 32.0;
    T2 = 30.0;
    T3 = 32.0;
    Tair = p.T_air0;
    let Qpipe = 0.0;
    let Qremoved = 0.0;
    let Efan3 = 0.0;
    let Epump = 0.0;
    let pipeRunHours = 0.0;
    for (let h = 0; h < HOURS; h += 1) {
      const [Tamb, G] = zhengzhouWeather(h);
      const inWindow = p.fan_start <= h && h < p.fan_end;
      const pipeOn = T3 > setpoint && inWindow;
      T1 = (alpha * G + hext * Tamb + Ulay * T2) / (hext + Ulay);
      T2 = (Ulay * T1 + Ulay * T3 + rhoCpAir * vdotMs * Tamb)
        / (2.0 * Ulay + rhoCpAir * vdotMs);
      const qLayer = Ulay * A * (T2 - T3);
      const qIn = Uroof * A * (T3 - Tair);
      const qPipe = pipeOn ? uaPipe * A * (T3 - Twater) : 0.0;
      T3 += (qLayer - qIn - qPipe) / Croof * STEP;
      Tair = (Uroof * A * T3 + p.UA_wall * Tamb + p.UA_grain * p.T_grain
        + Cair / STEP * Tair)
        / (Uroof * A + p.UA_wall + p.UA_grain + Cair / STEP);
      res.pipe.T1[h] = T1;
      res.pipe.T2[h] = T2;
      res.pipe.T3[h] = T3;
      res.pipe.q_in[h] = qIn;
      res.pipe.q_pipe[h] = qPipe;
      res.pipe.on[h] = pipeOn;
      Qpipe += qIn * STEP;
      Qremoved += qPipe * STEP;
      if (inWindow) Efan3 += Pfan;
      if (pipeOn) {
        Epump += p.P_pump;
        pipeRunHours += 1.0;
      }
    }

    const KWH = 3.6e6;
    const QbaseKwh = Qbase / KWH;
    const QdoubleKwh = Qdouble / KWH;
    const QpipeKwh = Qpipe / KWH;
    const QremovedKwh = Qremoved / KWH;
    const EcoolBaseKwh = QbaseKwh / COPref;
    const EfanKwh = Efan / 1000.0;
    const Efan3Kwh = Efan3 / 1000.0;
    const EpumpKwh = Epump / 1000.0;
    const EcoolKwh = QremovedKwh / COP;
    const EdoubleKwh = EfanKwh;
    const EpipeKwh = Efan3Kwh + EpumpKwh + EcoolKwh;
    const totalBaseKwh = EcoolBaseKwh;
    const totalDoubleKwh = EdoubleKwh + QdoubleKwh / COPref;
    const totalPipeKwh = EpipeKwh + QpipeKwh / COPref;
    const saveDouble = QbaseKwh - QdoubleKwh - EdoubleKwh;
    const savePipe = QbaseKwh - QpipeKwh - EpipeKwh;
    const rateDouble = QbaseKwh > 0 ? saveDouble / QbaseKwh * 100.0 : 0.0;
    const ratePipe = QbaseKwh > 0 ? savePipe / QbaseKwh * 100.0 : 0.0;
    const feeBase = totalBaseKwh * p.price;
    const feeDouble = totalDoubleKwh * p.price;
    const feePipe = totalPipeKwh * p.price;
    const peakBase = Math.max(...res.base.T3);
    const peakDouble = Math.max(...res.double.T3);
    const peakPipe = Math.max(...res.pipe.T3);

    return {
      res,
      Q_base_kwh: QbaseKwh,
      Q_double_kwh: QdoubleKwh,
      Q_pipe_kwh: QpipeKwh,
      Q_removed_kwh: QremovedKwh,
      E_cool_base_kwh: EcoolBaseKwh,
      E_fan_kwh: EfanKwh,
      E_fan3_kwh: Efan3Kwh,
      E_pump_kwh: EpumpKwh,
      E_cool_kwh: EcoolKwh,
      E_double_kwh: EdoubleKwh,
      E_pipe_kwh: EpipeKwh,
      total_base_kwh: totalBaseKwh,
      total_double_kwh: totalDoubleKwh,
      total_pipe_kwh: totalPipeKwh,
      save_double: saveDouble,
      save_pipe: savePipe,
      rate_double: rateDouble,
      rate_pipe: ratePipe,
      fee_base: feeBase,
      fee_double: feeDouble,
      fee_pipe: feePipe,
      peak_base: peakBase,
      peak_double: peakDouble,
      peak_pipe: peakPipe,
      red_double: peakBase - peakDouble,
      red_pipe: peakBase - peakPipe,
      pipe_run_hours: pipeRunHours,
    };
  }

  function evaluateEconomic(inputParams, result) {
    const p = { ...DEFAULT_PARAMS, ...inputParams };
    const investDouble = p.A * p.cost_double_per;
    const investPipe = p.A * p.cost_pipe_per;
    const daySaveDouble = result.fee_base - result.fee_double;
    const daySavePipe = result.fee_base - result.fee_pipe;
    const yearGrossDouble = daySaveDouble * p.hot_days_year;
    const yearGrossPipe = daySavePipe * p.hot_days_year;
    const maintainDouble = investDouble * p.maintain_rate / 100.0;
    const maintainPipe = investPipe * p.maintain_rate / 100.0;
    const yearNetDouble = yearGrossDouble - maintainDouble;
    const yearNetPipe = yearGrossPipe - maintainPipe;
    return {
      A: p.A,
      cost_double_per: p.cost_double_per,
      cost_pipe_per: p.cost_pipe_per,
      invest_double: investDouble,
      invest_pipe: investPipe,
      hot_days_year: p.hot_days_year,
      maintain_rate: p.maintain_rate,
      day_save_double: daySaveDouble,
      day_save_pipe: daySavePipe,
      year_gross_double: yearGrossDouble,
      year_gross_pipe: yearGrossPipe,
      maintain_double: maintainDouble,
      maintain_pipe: maintainPipe,
      year_net_double: yearNetDouble,
      year_net_pipe: yearNetPipe,
      payback_double: yearNetDouble > 1e-6 ? investDouble / yearNetDouble : null,
      payback_pipe: yearNetPipe > 1e-6 ? investPipe / yearNetPipe : null,
    };
  }

  function makeConclusion(r, eco, params) {
    const p = { ...DEFAULT_PARAMS, ...params };
    const payback = value => value == null ? "无正向经济收益" : `${value.toFixed(1)} 年`;
    const lines = [
      "【自动结论】",
      `注：仓内制冷COP_ref=${p.COP_ref}；运行费用采用全系统口径（仓内制冷+屋面改造设备电费）。`,
      `各工况包含仓内制冷的日总耗电：原屋面 ${r.total_base_kwh.toFixed(1)} kWh，双层通风屋面 ${r.total_double_kwh.toFixed(1)} kWh，双层+嵌管 ${r.total_pipe_kwh.toFixed(1)} kWh。`,
    ];
    if (r.rate_double > 0) {
      lines.push(`① 普通高温天气优先采用双层通风屋面：仓顶内表面峰值温度由 ${r.peak_base.toFixed(1)}℃ 降至 ${r.peak_double.toFixed(1)}℃（降低 ${r.red_double.toFixed(1)}℃），24h累计传入热量由 ${r.Q_base_kwh.toFixed(0)} kWh 降至 ${r.Q_double_kwh.toFixed(0)} kWh，扣除风机耗电后净节能率约 ${r.rate_double.toFixed(1)}%。`);
    } else {
      lines.push(`① 当前参数下双层通风屋面未取得净节能（${r.rate_double.toFixed(1)}%），建议优化通风量或空气层高度。`);
    }
    if (r.rate_pipe > r.rate_double) {
      lines.push(`② 双层+嵌管进一步将峰值温度降至 ${r.peak_pipe.toFixed(1)}℃，嵌管累计运行 ${r.pipe_run_hours.toFixed(0)} h，净节能率约 ${r.rate_pipe.toFixed(1)}%。`);
    } else if (r.rate_pipe > 0) {
      lines.push(`② 嵌管在仓顶超过 ${p.T_setpoint.toFixed(0)}℃ 时短时运行 ${r.pipe_run_hours.toFixed(0)} h，将峰值温度降至 ${r.peak_pipe.toFixed(1)}℃；净节能率约 ${r.rate_pipe.toFixed(1)}%，适合作为极端高温削峰手段。`);
    } else {
      lines.push(`② 当前参数下嵌管运行成本较高，净节能率为 ${r.rate_pipe.toFixed(1)}%，建议降低开启频率或提高冷源COP。`);
    }
    lines.push("", "【经济性·静态投资回收期】");
    lines.push(`双层通风屋面：总投资 ${eco.invest_double.toFixed(0)} 元，年净收益 ${eco.year_net_double.toFixed(0)} 元，静态回收期 ${payback(eco.payback_double)}。`);
    lines.push(`双层+嵌管：总投资 ${eco.invest_pipe.toFixed(0)} 元，年净收益 ${eco.year_net_pipe.toFixed(0)} 元，静态回收期 ${payback(eco.payback_pipe)}。`);
    lines.push("注：静态回收期不计利率、通胀与设备残值；总投资=屋面面积×单位面积造价。");
    return lines.join("\n");
  }

  return {
    DEFAULT_PARAMS,
    HOURS,
    STEP,
    zhengzhouWeather,
    simulate,
    evaluateEconomic,
    makeConclusion,
  };
});

