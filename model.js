(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GranaryModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 逐式移植“粮仓智改23_小修版.py”。保留原有1小时显式更新顺序与24小时统计。
  const DEFAULT_PARAMS = Object.freeze({
    A: 1000.0,
    U_roof: 1.2,
    h_layer: 0.3,
    Vdot: 30000.0,
    T_water: 17.0,
    T_setpoint: 35.0,
    price: 0.65,
    COP_ref: 2.5,
    cost_double_per: 100.0,
    cost_pipe_per: 220.0,
    hot_days_year: 90.0,
    maintain_rate_double: 1.5,
    maintain_rate_pipe: 1.0,
    alpha: 0.7,
    Gmax: 850.0,
    h_ext: 15.0,
    ua_pipe: 2.5,
    fan_factor: 0.06,
    P_pump: 2200.0,
    fan_start: 9.0,
    fan_end: 18.0,
    rho_roof: 2400.0,
    cp_roof: 880.0,
    delta_roof: 0.12,
    bin_h: 4.0,
    UA_wall: 840.0,
    UA_grain: 500.0,
    T_grain: 28.0,
    T_air_set: 23.0,
  });

  const HOURS = 24;
  const STEP = 3600.0;

  function zhengzhouWeather(hour) {
    // 与“粮仓智改15.py”保持一致：最低气温在3:00、最高气温在15:00。
    // 气温峰值晚于太阳辐射峰值，体现室外环境的热惯性。
    const tmax = 38.0;
    const tmin = 26.0;
    const tvalley = 3.0;
    const temperature = (tmax + tmin) / 2.0
      + (tmax - tmin) / 2.0
        * Math.sin(Math.PI * (hour - tvalley) / 12.0 - Math.PI / 2.0);
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
    const COPref = p.COP_ref;
    const alpha = p.alpha;
    const hext = p.h_ext;
    const uaPipe = p.ua_pipe;
    const setpoint = p.T_setpoint;

    const Croof = p.rho_roof * p.cp_roof * p.delta_roof * A;
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
    const Tair = p.T_air_set;
    let Qbase = 0.0;
    let QcoolBase = 0.0;
    for (let h = 0; h < HOURS; h += 1) {
      const [Tamb, G] = zhengzhouWeather(h);
      res.T_amb[h] = Tamb;
      res.G[h] = G;
      const qSolar = alpha * G * A;
      const qExt = hext * A * (T3 - Tamb);
      const qIn = Uroof * A * (T3 - Tair);
      T3 += (qSolar - qExt - qIn) / Croof * STEP;
      const qWall = p.UA_wall * (Tamb - Tair);
      const qGrain = p.UA_grain * (p.T_grain - Tair);
      const qCool = Math.max(0, qIn + qWall + qGrain);
      res.base.T3[h] = T3;
      res.base.q_in[h] = qIn;
      Qbase += qIn * STEP;
      QcoolBase += qCool * STEP;
    }

    // 工况二：双层通风屋面。
    let T1 = 32.0;
    let T2 = 30.0;
    T3 = 32.0;
    let Qdouble = 0.0;
    let QcoolDouble = 0.0;
    let Efan = 0.0;
    for (let h = 0; h < HOURS; h += 1) {
      const [Tamb, G] = zhengzhouWeather(h);
      const fanOn = p.fan_start <= h && h < p.fan_end;
      res.double.fan_on[h] = fanOn;
      const vdot = fanOn ? vdotMs : 0.0;
      T1 = (alpha * G + hext * Tamb + Ulay * T2) / (hext + Ulay);
      T2 = (Ulay * T1 + Ulay * T3 + rhoCpAir * vdot * Tamb)
        / (2.0 * Ulay + rhoCpAir * vdot);
      const qLayer = Ulay * A * (T2 - T3);
      const qIn = Uroof * A * (T3 - Tair);
      T3 += (qLayer - qIn) / Croof * STEP;
      const qWall = p.UA_wall * (Tamb - Tair);
      const qGrain = p.UA_grain * (p.T_grain - Tair);
      const qCool = Math.max(0, qIn + qWall + qGrain);
      res.double.T1[h] = T1;
      res.double.T2[h] = T2;
      res.double.T3[h] = T3;
      res.double.q_in[h] = qIn;
      Qdouble += qIn * STEP;
      QcoolDouble += qCool * STEP;
      if (fanOn) Efan += Pfan;
    }

    // 工况三：双层屋面加嵌管辅助降温。
    T1 = 32.0;
    T2 = 30.0;
    T3 = 32.0;
    let Qpipe = 0.0;
    let QcoolPipe = 0.0;
    let Qremoved = 0.0;
    let Efan3 = 0.0;
    let Epump = 0.0;
    let pipeRunHours = 0.0;
    for (let h = 0; h < HOURS; h += 1) {
      const [Tamb, G] = zhengzhouWeather(h);
      const inWindow = p.fan_start <= h && h < p.fan_end;
      const pipeOn = T3 > setpoint && T3 > Twater && inWindow;
      const vdot = inWindow ? vdotMs : 0.0;
      T1 = (alpha * G + hext * Tamb + Ulay * T2) / (hext + Ulay);
      T2 = (Ulay * T1 + Ulay * T3 + rhoCpAir * vdot * Tamb)
        / (2.0 * Ulay + rhoCpAir * vdot);
      const qLayer = Ulay * A * (T2 - T3);
      const qIn = Uroof * A * (T3 - Tair);
      const qPipe = pipeOn ? uaPipe * A * (T3 - Twater) : 0.0;
      T3 += (qLayer - qIn - qPipe) / Croof * STEP;
      const qWall = p.UA_wall * (Tamb - Tair);
      const qGrain = p.UA_grain * (p.T_grain - Tair);
      const qCool = Math.max(0, qIn + qWall + qGrain);
      res.pipe.T1[h] = T1;
      res.pipe.T2[h] = T2;
      res.pipe.T3[h] = T3;
      res.pipe.q_in[h] = qIn;
      res.pipe.q_pipe[h] = qPipe;
      res.pipe.on[h] = pipeOn;
      Qpipe += qIn * STEP;
      QcoolPipe += qCool * STEP;
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
    // 三方案均24小时保持同一空气温度；先逐时截取总冷负荷正值，再累加并除以COP。
    const QcoolBaseKwh = QcoolBase / KWH;
    const QcoolDoubleKwh = QcoolDouble / KWH;
    const QcoolPipeKwh = QcoolPipe / KWH;
    const EcoolBaseKwh = QcoolBaseKwh / COPref;
    const EcoolDoubleKwh = QcoolDoubleKwh / COPref;
    const EcoolPipeKwh = QcoolPipeKwh / COPref;
    const EfanKwh = Efan / 1000.0;
    const Efan3Kwh = Efan3 / 1000.0;
    const EpumpKwh = Epump / 1000.0;
    // 土壤源直接供冷，无嵌管侧压缩机；泵耗已单独计入。
    const EpipeSourceKwh = 0.0;
    const EdoubleKwh = EfanKwh;
    const EpipeKwh = Efan3Kwh + EpumpKwh + EpipeSourceKwh;
    const totalBaseKwh = EcoolBaseKwh;
    const totalDoubleKwh = EcoolDoubleKwh + EdoubleKwh;
    const totalPipeKwh = EcoolPipeKwh + EpipeKwh;

    // 净节电量和节电率统一采用“全系统实际耗电”口径，避免热量与电量直接相减。
    const saveDouble = EcoolBaseKwh - EcoolDoubleKwh - EdoubleKwh;
    const savePipe = EcoolBaseKwh - EcoolPipeKwh - EpipeKwh;
    const rateDouble = totalBaseKwh > 0 ? saveDouble / totalBaseKwh * 100.0 : 0.0;
    const ratePipe = totalBaseKwh > 0 ? savePipe / totalBaseKwh * 100.0 : 0.0;
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
      Q_cool_base_kwh: QcoolBaseKwh,
      Q_cool_double_kwh: QcoolDoubleKwh,
      Q_cool_pipe_kwh: QcoolPipeKwh,
      E_cool_base_kwh: EcoolBaseKwh,
      E_cool_double_kwh: EcoolDoubleKwh,
      E_cool_pipe_kwh: EcoolPipeKwh,
      E_fan_kwh: EfanKwh,
      E_fan3_kwh: Efan3Kwh,
      E_pump_kwh: EpumpKwh,
      E_pipe_source_kwh: EpipeSourceKwh,
      // 保留旧字段名，兼容此前导出的模型快照。
      E_cool_kwh: EpipeSourceKwh,
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
    const maintainDouble = investDouble * p.maintain_rate_double / 100.0;
    const maintainPipe = investPipe * p.maintain_rate_pipe / 100.0;
    const yearNetDouble = yearGrossDouble - maintainDouble;
    const yearNetPipe = yearGrossPipe - maintainPipe;
    return {
      A: p.A,
      cost_double_per: p.cost_double_per,
      cost_pipe_per: p.cost_pipe_per,
      invest_double: investDouble,
      invest_pipe: investPipe,
      hot_days_year: p.hot_days_year,
      maintain_rate_double: p.maintain_rate_double,
      maintain_rate_pipe: p.maintain_rate_pipe,
      T_air_set: p.T_air_set,
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
    const rateText = value => value >= 0
      ? `节电率 ${value.toFixed(1)}%`
      : `耗电增加 ${Math.abs(value).toFixed(1)}%`;
    const lines = [
      "【自动结论】",
      `注：三种方案仓内空气控制温度均为 ${p.T_air_set.toFixed(1)}℃，24小时维持同一设定温度；仓内制冷COP_ref=${p.COP_ref}；嵌管采用土壤源直接供冷，无嵌管侧压缩机，仅计循环水泵耗电。日运行费用采用仓内制冷＋屋面设备电费口径。`,
      `各工况包含仓内制冷的日总耗电：原屋面 ${r.total_base_kwh.toFixed(1)} kWh，双层通风屋面 ${r.total_double_kwh.toFixed(1)} kWh，双层+嵌管 ${r.total_pipe_kwh.toFixed(1)} kWh。`,
    ];
    if (r.rate_double > 0) {
      lines.push(`① 双层通风屋面：仓顶模拟峰值温度由 ${r.peak_base.toFixed(1)}℃ 降至 ${r.peak_double.toFixed(1)}℃（降低 ${r.red_double.toFixed(1)}℃）；全系统日耗电减少 ${r.save_double.toFixed(1)} kWh，${rateText(r.rate_double)}。`);
    } else {
      lines.push(`① 当前参数下双层通风屋面未取得全系统节电效果（${rateText(r.rate_double)}），建议优化通风量、空气层高度或运行时段。`);
    }
    lines.push(`② 双层＋土壤源嵌管：仓顶超过 ${p.T_setpoint.toFixed(0)}℃ 且高于供水温度 ${p.T_water.toFixed(1)}℃ 时，在 ${p.fan_start}:00—${p.fan_end}:00 允许时段内开启；累计运行 ${r.pipe_run_hours.toFixed(0)} h，水泵耗电 ${r.E_pump_kwh.toFixed(1)} kWh，取走屋面热量 ${r.Q_removed_kwh.toFixed(1)} kWh（热量）。仓顶峰值 ${r.peak_pipe.toFixed(1)}℃；全系统${rateText(r.rate_pipe)}。`);
    lines.push(r.total_pipe_kwh < r.total_double_kwh
      ? `本工况下嵌管组合比双层方案日耗电减少 ${(r.total_double_kwh-r.total_pipe_kwh).toFixed(2)} kWh；经济性仍需同时考虑新增投资和维护。`
      : `本工况下嵌管组合未比双层方案进一步节电（日耗电差 ${(r.total_pipe_kwh-r.total_double_kwh).toFixed(2)} kWh），不能据此宣称嵌管经济性最优。`);
    lines.push("", "【关键指标汇总】");
    for (const [key,name] of [["base","原屋面"],["double","双层通风屋面"],["pipe","双层＋土壤源嵌管"]]) {
      lines.push(`${name}：峰值温度 ${r['peak_'+key].toFixed(1)}℃ | 屋面净传入热量 ${r['Q_'+key+'_kwh'].toFixed(0)} kWh | 仓内制冷 ${r['E_cool_'+key+'_kwh'].toFixed(1)} kWh | 日总耗电 ${r['total_'+key+'_kwh'].toFixed(1)} kWh | 日电费 ${r['fee_'+key].toFixed(2)}元。`);
    }
    lines.push("", "【经济性·静态投资回收期】");
    lines.push(`屋面面积 ${p.A.toFixed(0)}㎡；双层造价 ${p.cost_double_per.toFixed(1)}元/㎡；双层＋土壤源嵌管整套造价 ${p.cost_pipe_per.toFixed(1)}元/㎡；年高温运行 ${p.hot_days_year.toFixed(0)}天。`);
    lines.push(`完整改造系统年度维护费率：双层 ${p.maintain_rate_double.toFixed(1)}%（${eco.maintain_double.toFixed(0)}元/年）；双层＋土壤源嵌管 ${p.maintain_rate_pipe.toFixed(1)}%（${eco.maintain_pipe.toFixed(0)}元/年）。`);
    lines.push(`双层通风屋面：总投资 ${eco.invest_double.toFixed(0)} 元，年净收益 ${eco.year_net_double.toFixed(0)} 元，静态回收期 ${payback(eco.payback_double)}。`);
    lines.push(`双层+嵌管：总投资 ${eco.invest_pipe.toFixed(0)} 元，年净收益 ${eco.year_net_pipe.toFixed(0)} 元，静态回收期 ${payback(eco.payback_pipe)}。`);
    lines.push("注：年净收益=单日电费节约×运行天数−年维护费；静态回收期=改造投资÷年净收益，仅在净收益为正时计算，不计利率、通胀与设备残值。");
    lines.push("模型边界：本预览按粮仓智改23版简化模型计算；统一的是仓内空气温度，并非整仓粮温。冷负荷包含屋面、墙体与固定粮堆表层换热，未完整考虑渗透、呼吸热等；未模拟初始整仓降温过程。土壤源定温供水为假设，未校核地埋管持续供冷能力。气象为合成高温日，年收益为该日乘运行天数估算；造价与维护费率为估算输入，并非实测或工程报价。");
    lines.push("记录约定：沿用23版，横轴h对应第h个小时计算步；气象与热流取步初，仓顶温度为该步计算结束值。仓顶曲线为等效节点模拟值，不代表粮温或实测内表面温度。");
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
