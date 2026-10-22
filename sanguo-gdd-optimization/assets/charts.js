(function () {
  'use strict';

  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var gold = style.getPropertyValue('--gold').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  var charts = [];

  function mount(id, option) {
    var el = document.getElementById(id);
    if (!el) return;
    var c = echarts.init(el, null, { renderer: 'svg' });
    c.setOption(option);
    charts.push(c);
  }

  // ---------------- Matrix: priority scatter ----------------
  var issues = [
    { code: 'E01', name: '交易汇率 / 农业支配', cost: 1.2, impact: 4.78, p: 0, color: accent },
    { code: 'E02', name: '粮食溢出归零', cost: 1.0, impact: 4.20, p: 0, color: accent },
    { code: 'E03', name: '商业独立价值', cost: 1.8, impact: 4.60, p: 1, color: gold },
    { code: 'E04', name: '相性 / 地形表缺失', cost: 1.3, impact: 4.00, p: 0, color: accent },
    { code: 'E05', name: '伤害公式缺口', cost: 2.0, impact: 4.30, p: 0, color: accent },
    { code: 'E06', name: '30 天限时', cost: 1.05, impact: 2.75, p: 2, color: accent2 },
    { code: 'E07', name: '极兵支配', cost: 3.0, impact: 4.70, p: 1, color: gold },
    { code: 'E08', name: '玄兵无限锁', cost: 2.65, impact: 4.05, p: 1, color: gold },
    { code: 'E09', name: '忠诚操作税', cost: 2.2, impact: 3.60, p: 1, color: gold },
    { code: 'E10', name: '内政节奏错位', cost: 1.6, impact: 3.35, p: 2, color: accent2 },
    { code: 'E11', name: '固定搜索点位', cost: 2.4, impact: 3.30, p: 2, color: accent2 },
    { code: 'E12', name: '计策绑等级', cost: 2.0, impact: 2.95, p: 2, color: accent2 },
    { code: 'E13', name: 'AI 不可归因', cost: 2.35, impact: 3.82, p: 1, color: gold },
    { code: 'E14', name: '存档确定性', cost: 2.45, impact: 4.40, p: 0, color: accent }
  ];

  var matrixData = issues.map(function (d) {
    return {
      value: [d.cost, d.impact],
      code: d.code,
      name: d.name,
      cost: d.cost,
      impact: d.impact,
      pri: d.p,
      itemStyle: { color: d.color, borderColor: bg2, borderWidth: 1.5 },
      symbolSize: 10 + d.impact * 2.2
    };
  });

  mount('chart-matrix', {
    animation: false,
    grid: { left: 46, right: 18, top: 28, bottom: 44 },
    tooltip: {
      appendToBody: true,
      trigger: 'item',
      backgroundColor: bg2,
      borderColor: rule,
      textStyle: { color: ink, fontSize: 12, fontFamily: 'PingFang SC, Noto Sans SC, sans-serif' },
      formatter: function (p) {
        return '<b>' + p.data.code + '</b>　' + p.data.name +
          '<br/>影响 ' + p.data.impact.toFixed(1) + '　成本 ' + p.data.cost.toFixed(1) +
          '<br/>优先级 ' + ['P0', 'P1', 'P2'][p.data.pri];
      }
    },
    xAxis: {
      min: 0.5, max: 3.6,
      name: '实施成本 →',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: muted, fontSize: 11 },
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 10 },
      splitLine: { lineStyle: { color: rule, type: 'dashed', opacity: 0.45 } }
    },
    yAxis: {
      min: 2.5, max: 5.2,
      name: '玩家影响 →',
      nameTextStyle: { color: muted, fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 10 },
      splitLine: { lineStyle: { color: rule, type: 'dashed', opacity: 0.45 } }
    },
    series: [{
      type: 'scatter',
      data: matrixData,
      label: {
        show: true,
        position: 'top',
        distance: 5,
        color: muted,
        fontSize: 9,
        fontFamily: 'JetBrains Mono, monospace',
        formatter: function (p) { return p.data.code; }
      },
      markArea: {
        silent: true,
        label: { show: true, color: muted, fontSize: 10, padding: [6, 8, 0, 8] },
        data: [
          [{ xAxis: 0.5, yAxis: 3.8, name: '立即修', itemStyle: { color: 'rgba(163,52,43,0.055)' }, label: { position: 'insideTopLeft' } }, { xAxis: 2.2, yAxis: 5.2 }],
          [{ xAxis: 2.2, yAxis: 3.8, name: '规划修', itemStyle: { color: 'rgba(150,112,47,0.06)' }, label: { position: 'insideTopRight' } }, { xAxis: 3.6, yAxis: 5.2 }],
          [{ xAxis: 0.5, yAxis: 2.5, name: '顺手修', itemStyle: { color: 'rgba(47,95,87,0.05)' }, label: { position: 'insideBottomLeft' } }, { xAxis: 2.2, yAxis: 3.8 }],
          [{ xAxis: 2.2, yAxis: 2.5, name: '观察', itemStyle: { color: 'rgba(109,100,87,0.04)' }, label: { position: 'insideBottomRight' } }, { xAxis: 3.6, yAxis: 3.8 }]
        ]
      }
    }]
  });

  // ---------------- Economy: three investment paths ----------------
  var points = [];
  for (var i = 0; i <= 10; i++) points.push(i * 50);

  mount('chart-economy', {
    animation: false,
    color: [accent, accent2, muted],
    grid: { left: 54, right: 64, top: 38, bottom: 44 },
    legend: {
      top: 4,
      left: 0,
      itemWidth: 14,
      itemHeight: 3,
      textStyle: { color: muted, fontSize: 11, fontFamily: 'PingFang SC, Noto Sans SC, sans-serif' }
    },
    tooltip: {
      appendToBody: true,
      trigger: 'axis',
      backgroundColor: bg2,
      borderColor: rule,
      textStyle: { color: ink, fontSize: 12 },
      axisPointer: { lineStyle: { color: rule } },
      formatter: function (params) {
        var s = '累计投入 <b>' + params[0].axisValue + '</b> 点<br/>';
        params.forEach(function (p) {
          s += p.marker + p.seriesName + '：<b>' + Math.round(p.value) + '</b> 兵<br/>';
        });
        return s;
      }
    },
    xAxis: {
      type: 'category',
      data: points,
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 10 }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 10 },
      splitLine: { lineStyle: { color: rule, type: 'dashed', opacity: 0.5 } }
    },
    series: [
      {
        name: '全投农业',
        type: 'line',
        smooth: false,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2.2 },
        endLabel: { show: true, color: accent, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', formatter: '{c}' },
        data: points.map(function (p) { return Math.round(6.857 * p); })
      },
      {
        name: '农商各半',
        type: 'line',
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2.2 },
        endLabel: { show: true, color: accent2, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', formatter: '{c}' },
        data: points.map(function (p) { return Math.round((6.857 + 0.457) * p / 2); })
      },
      {
        name: '全投商业',
        type: 'line',
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2, type: 'dashed' },
        endLabel: { show: true, color: muted, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', formatter: '{c}' },
        data: points.map(function (p) { return Math.round(0.457 * p); })
      }
    ]
  });

  // ---------------- Battle: rounds vs time limit ----------------
  mount('chart-battle', {
    animation: false,
    grid: { left: 48, right: 24, top: 40, bottom: 40 },
    tooltip: {
      appendToBody: true,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(27,25,22,0.04)' } },
      backgroundColor: bg2,
      borderColor: rule,
      textStyle: { color: ink, fontSize: 12 },
      formatter: function (params) {
        return params[0].axisValue + '：<b>' + params[0].value + '</b> 回合';
      }
    },
    xAxis: {
      type: 'category',
      data: ['平原遭遇', '森林据守', '攻城 2:1', '极兵突袭'],
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      name: '回合',
      max: 32,
      nameTextStyle: { color: muted, fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 10 },
      splitLine: { lineStyle: { color: rule, type: 'dashed', opacity: 0.5 } }
    },
    series: [{
      type: 'bar',
      barWidth: '42%',
      data: [7, 10, 7, 8],
      itemStyle: { color: accent, opacity: 0.82 },
      label: { show: true, position: 'top', color: accent, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', formatter: '{c} 回合' },
      markLine: {
        silent: true,
        symbol: 'none',
        data: [
          {
            yAxis: 30,
            lineStyle: { color: accent, type: 'dashed', width: 1.2 },
            label: { show: true, position: 'insideEndBottom', color: accent, fontSize: 11, formatter: '现行 30 天上限' }
          },
          {
            yAxis: 15,
            lineStyle: { color: accent2, type: 'dotted', width: 1.2 },
            label: { show: true, position: 'insideStartBottom', color: accent2, fontSize: 11, formatter: '建议上限 15 天' }
          }
        ]
      }
    }]
  });

  // ---------------- Mermaid ----------------
  if (window.mermaid) {
    window.mermaid.initialize({
      startOnLoad: true,
      theme: 'base',
      securityLevel: 'loose',
      themeVariables: {
        background: '#fffdf8',
        primaryColor: '#f4efe3',
        primaryTextColor: '#1b1916',
        primaryBorderColor: '#c9bfa9',
        lineColor: '#8d8375',
        secondaryColor: '#e9e2d2',
        tertiaryColor: '#fffdf8',
        fontFamily: 'PingFang SC, Noto Sans SC, sans-serif',
        fontSize: '12px',
        nodeBorder: '#c9bfa9',
        clusterBkg: '#fffdf8',
        edgeLabelBackground: '#f4f0e6'
      },
      flowchart: { curve: 'basis', htmlLabels: true, padding: 10 }
    });
  }

  window.addEventListener('resize', function () {
    charts.forEach(function (c) { c.resize(); });
  });
})();
