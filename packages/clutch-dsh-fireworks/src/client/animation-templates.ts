import emoji from '../../assets/animations/emoji.js?raw';
import classic from '../../assets/animations/classic.js?raw';
import rings from '../../assets/animations/rings.js?raw';
import { parseAnimation, type AnimationPreferences, type AnimationTemplate } from '../animation.js';

export const BUILTIN_ANIMATIONS = [
  parseAnimation(emoji, 'emoji'),
  parseAnimation(classic, 'classic'),
  parseAnimation(rings, 'rings'),
];
export function animationTemplates(preferences: AnimationPreferences): AnimationTemplate[] {
  return [
    ...BUILTIN_ANIMATIONS,
    ...Object.entries(preferences.scripts).map(([id, source]) => parseAnimation(source, id)),
  ];
}
export function selectedAnimation(preferences: AnimationPreferences): AnimationTemplate {
  return (
    animationTemplates(preferences).find((template) => template.id === preferences.active) ??
    BUILTIN_ANIMATIONS[0]
  );
}

export const ANIMATION_GENERATION_PROMPT = `请为 DSH 的 clutch_fireworks 制作一个透明全屏庆祝动画。输出一个完整 .js 文件，不要 Markdown 围栏，不要外部依赖。第一行必须是：
// clutch_fireworks: {"version":1,"name":"我的动画","durationMs":4000}
时长 500–8000 ms，名称最多 60 字，文件最多 64 KiB。
定义同步函数 function render(frame, fx) { ... }。渲染器逐帧调用它并自动清屏、适配 DPR 和窗口大小、停止与释放资源；不要自行建立循环、定时器或事件监听。
frame = {ctx, width, height, time, delta, progress, durationMs, dpr, seed, message}。
ctx 是标准 OffscreenCanvasRenderingContext2D，可画路径、曲线、渐变、文字、粒子、混合和阴影；width/height 是 CSS 像素；time/delta 是毫秒；progress 从 0 到 1。按绝对 time 计算运动，使不同帧率下结果一致。
fx.random() 是每帧重置的确定性随机数，适合生成稳定的粒子初始位置；fx.clamp(p) 限制到 0..1；fx.easeOut(p) 为三次缓出。
绘图助手：
fx.circle(x,y,r,color,alpha=1,glow=0)
fx.ring(x,y,r,color,lineWidth=2,alpha=1)
fx.line(x1,y1,x2,y2,color,lineWidth=2,alpha=1)
fx.star(x,y,r,color,alpha=1,rotation=0)
fx.emoji(text,x,y,size=32,alpha=1,rotation=0)
alpha 为 0..1，rotation 为弧度，color 使用 CSS 颜色。每帧最多约 1000 个粒子；开始和结束平滑淡入淡出；透明背景，兼顾深浅主题。
脚本在隔离 Worker 内运行，没有 DOM、DSH、网络、存储、模块导入或导航能力。不要使用 fetch/import/importScripts/require/window/document，不要调用 postMessage 或覆盖全局函数。只用 frame、fx、ctx 和纯数学。
toast 与会话跳转由宿主统一管理，请勿绘制通知、按钮或管理 Session。
请把动画风格改成：<在这里描述你想要的视觉效果>。`;
