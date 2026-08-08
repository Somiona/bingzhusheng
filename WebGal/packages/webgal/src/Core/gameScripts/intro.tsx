import { ISentence } from '@/Core/controller/scene/sceneInterface';
import { IPerform } from '@/Core/Modules/perform/performInterface';
import React from 'react';
import { renderReact, unmountReact } from '@/Core/util/reactRoot';
import styles from '@/Stage/FullScreenPerform/fullScreenPerform.module.scss';
import { WebGAL } from '@/Core/WebGAL';
import useEscape from '@/hooks/useEscape';
import { webgalStore } from '@/store/store';
import { getBooleanArgByKey, getNumberArgByKey, getStringArgByKey } from '../util/getSentenceArg';
/**
 * 显示一小段黑屏演示
 * @param sentence
 *
 * 【本地定制】新增 -vocals / -delays 参数，支持「每段配音驱动 + 手动延迟」的逐段显示。
 * - -vocals=a.mp3,b.mp3,... ：按 | 段顺序的配音文件名，该段时长由音频实际时长决定。
 * - -delays=1500,2000,...   ：按 | 段顺序的手动停留毫秒数，用于没有配音的段。
 * 每段时长优先级：-vocals[i] > -delays[i] > 全局 -delayTime。文字累积显示。
 * 不带这两个参数时，行为与原版完全一致（等间隔 delayTime）。
 */
export const intro = (sentence: ISentence): IPerform => {
  /**
   * intro 内部控制
   */

  const performName = `introPerform${Math.random().toString()}`;

  const fontSizeFromArgs = getStringArgByKey(sentence, 'fontSize') ?? 'medium';
  let fontSize = '350%';
  switch (fontSizeFromArgs) {
    case 'small':
      fontSize = '280%';
      break;
    case 'medium':
      fontSize = '350%';
      break;
    case 'large':
      fontSize = '420%';
      break;
  }
  const backgroundImageFromArgs = getStringArgByKey(sentence, 'backgroundImage') ?? '';
  const backgroundImage = `url("game/background/${backgroundImageFromArgs}") center/cover no-repeat`;
  const backgroundColor = getStringArgByKey(sentence, 'backgroundColor') ?? 'rgba(0, 0, 0, 1)';
  const color = getStringArgByKey(sentence, 'fontColor') ?? 'rgba(255, 255, 255, 1)';
  const animationFromArgs = getStringArgByKey(sentence, 'animation') ?? '';
  let animationClass: any = (type: string, length = 0) => {
    switch (type) {
      case 'fadeIn':
        return styles.fadeIn;
      case 'slideIn':
        return styles.slideIn;
      case 'typingEffect':
        return `${styles.typingEffect} ${length}`;
      case 'pixelateEffect':
        return styles.pixelateEffect;
      case 'revealAnimation':
        return styles.revealAnimation;
      default:
        return styles.fadeIn;
    }
  };
  let chosenAnimationClass = animationClass(animationFromArgs);

  // 【本地定制】解析 -vocals（逗号分隔的配音文件名，按 | 段顺序）与 -delays（逗号分隔的毫秒数）。
  const rawDelayTime = getNumberArgByKey(sentence, 'delayTime') ?? 1500;
  const vocalsArg = getStringArgByKey(sentence, 'vocals') ?? '';
  const delaysArg = getStringArgByKey(sentence, 'delays') ?? '';
  // 用裸文件名（与 say.vocal 一致），预加载缓存才能命中；运行时由引擎解析到 game/vocal/ 下
  const vocalFiles: string[] = vocalsArg
    ? vocalsArg
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const delayNumbers: Array<number | undefined> = delaysArg
    ? delaysArg.split(',').map((s) => {
        const trimmed = s.trim();
        if (trimmed === '') return undefined;
        const n = Number(trimmed);
        return Number.isNaN(n) ? undefined : n;
      })
    : [];
  const hasCustomTiming = vocalFiles.length > 0 || delayNumbers.length > 0;

  let delayTime = rawDelayTime;
  let isHold = getBooleanArgByKey(sentence, 'hold') ?? false;
  let isUserForward = getBooleanArgByKey(sentence, 'userForward') ?? false;
  // 设置一个很大的延迟，这样自然就看起来不自动继续了
  delayTime = isUserForward ? 99999999 : delayTime;
  // 用户手动控制向前步进，所以必须是 hold
  isHold = isUserForward ? true : isHold;

  const introContainerStyle = {
    background: backgroundImage,
    backgroundColor: backgroundColor,
    color: color,
    fontSize: fontSize || '350%',
    width: '100%',
    height: '100%',
  };
  const introArray: Array<string> = sentence.content.split(/(?<!\\)\|/).map((val: string) => useEscape(val));

  // 【本地定制】新逻辑下，每段初始隐藏（一个极大的 animationDelay，等价于不自动开始），
  // 由串行播放器在「轮到该段」时把 animationDelay 清零并重置动画来触发淡入。
  const HIDDEN_DELAY_MS = 1000 * 60 * 60; // 1 小时
  const renderDelayFor = (i: number) => (hasCustomTiming ? HIDDEN_DELAY_MS : delayTime * i);

  /**
   * 构造 intro 视图。真正挂载必须等 commit 后的 startFunction。
   */
  const showIntro = introArray.map((e, i) => (
    <div
      key={'introtext' + i + Math.random().toString()}
      data-intro-segment={i}
      style={{ animationDelay: `${renderDelayFor(i)}ms` }}
      className={chosenAnimationClass}
    >
      {e}
      {e === '' ? ' ' : ''}
    </div>
  ));
  const intro = (
    <div style={introContainerStyle}>
      <div style={{ padding: '3em 4em 3em 4em' }}>{showIntro}</div>
    </div>
  );

  // ============================================================
  // 【本地定制】分支一：音频 / 延迟驱动的逐段显示
  // 每段时长优先级：-vocals[i]（音频实际时长） > -delays[i]（手动毫秒） > 全局 delayTime
  // 串行播放器：音频段走 audio.onended、延迟段走 setTimeout，统一推进指针；文字累积显示。
  // ============================================================
  if (hasCustomTiming) {
    let isBlocking = true;
    let settled = false; // 是否已进入收尾（防止重复结束）
    let currentIndex = 0;
    let currentAudio: HTMLAudioElement | null = null;
    let currentTimer: ReturnType<typeof setTimeout> | undefined;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    let blockingFallbackTimer: ReturnType<typeof setTimeout> | undefined;

    // 配音音量：主音量 × 语音音量（与 AudioContainer 的 vocalVol 口径一致）
    const calcVocalVolume = () => {
      const ud = webgalStore.getState().userData;
      const mainVol = ud.optionData.volumeMain;
      const vocalVol = ud.optionData.vocalVolume ?? 100;
      return Math.max(0, Math.min(1, mainVol * 0.01 * vocalVol * 0.01));
    };

    // 触发第 i 段淡入（累积：已淡入的段保留在屏幕上）。
    // 用 reflow trick 强制重启 CSS 动画：避免初始的大 animationDelay 让 getAnimations/play
    // 卡在 delay 区间，导致第一段文字永远不淡入（单段 intro 因此完全无字）。
    const triggerSegmentIn = (i: number) => {
      const node = document.querySelector<HTMLElement>(`#introContainer [data-intro-segment="${i}"]`);
      if (!node) return;
      node.style.animationDelay = '0ms';
      node.style.animation = 'none';
      // 强制 reflow，使 animation: none 生效
      void node.offsetWidth;
      // 恢复空值，重新应用 className 上的 fadeIn 等动画，从 0 开始播放
      node.style.animation = '';
    };

    const clearCurrent = () => {
      if (currentAudio) {
        currentAudio.onended = null;
        currentAudio.onerror = null;
        currentAudio.pause();
        currentAudio = null;
      }
      if (currentTimer) {
        clearTimeout(currentTimer);
        currentTimer = undefined;
      }
    };

    const endPerform = () => {
      if (settled) return;
      settled = true;
      isBlocking = false;
      WebGAL.gameplay.performController.unmountPerform(performName);
    };

    // 处理当前段（播放音频或计时）
    const processCurrentSegment = () => {
      if (settled || currentIndex >= introArray.length) return;
      const i = currentIndex;
      triggerSegmentIn(i);
      const vocalFile = vocalFiles[i];
      if (vocalFile) {
        currentAudio = new Audio(vocalFile);
        currentAudio.volume = calcVocalVolume();
        const advance = () => advanceSegment(false);
        currentAudio.onended = advance;
        currentAudio.onerror = advance;
        // 浏览器自动播放策略或加载失败时不能卡死：降级为按 delayTime 计时后继续
        currentAudio.play().catch(() => {
          clearCurrent();
          currentTimer = setTimeout(() => advanceSegment(false), rawDelayTime);
        });
      } else {
        const dur = delayNumbers[i] ?? rawDelayTime;
        currentTimer = setTimeout(() => advanceSegment(false), dur);
      }
    };

    // 推进到下一段。byUser=true 表示是用户点击触发的推进（hold 模式下靠它结束）。
    const advanceSegment = (byUser: boolean) => {
      if (settled) return;
      clearCurrent();
      currentIndex += 1;
      if (currentIndex >= introArray.length) {
        // 全部段已显示完
        if (isHold && !byUser) return; // hold：自动走完后停留，等用户点击结束
        endPerform();
        return;
      }
      processCurrentSegment();
    };

    // 用户点击 = 跳过当前段，进入下一段
    const onUserNext = () => advanceSegment(true);

    return {
      performName,
      duration: 1000 * 60 * 60 * 24,
      isHoldOn: false,
      startFunction: () => {
        isBlocking = true;
        WebGAL.events.userInteractNext.on(onUserNext);
        renderReact(intro, document.getElementById('introContainer'));
        const introContainer = document.getElementById('introContainer');
        if (introContainer) {
          introContainer.style.display = 'block';
        }
        // 兜底：极端异常时确保最终能解除阻塞，避免卡死整局游戏
        blockingFallbackTimer = setTimeout(() => {
          isBlocking = false;
        }, 1000 * 60 * 10);
        // renderReact 使用 createRoot（异步挂载），需等 DOM 真正渲染后再触发第一段，
        // 否则 triggerSegmentIn 的 querySelector 找不到节点，导致第一句文字不会淡入。
        startTimer = setTimeout(processCurrentSegment, 0);
      },
      stopFunction: () => {
        const introContainer = document.getElementById('introContainer');
        if (introContainer) {
          introContainer.style.display = 'none';
        }
        unmountReact(introContainer);
        clearCurrent();
        if (startTimer) clearTimeout(startTimer);
        if (blockingFallbackTimer) clearTimeout(blockingFallbackTimer);
        WebGAL.events.userInteractNext.off(onUserNext);
      },
      blockingNext: () => isBlocking,
      blockingAuto: () => isBlocking,
      goNextWhenOver: true,
    };
  }

  // ============================================================
  // 分支二：原版等间隔 delayTime 逻辑（未传 -vocals / -delays 时，保持原行为）
  // ============================================================
  let endWait = 1000;
  let baseDuration = endWait + delayTime * introArray.length;
  const duration = isHold ? 1000 * 60 * 60 * 24 : 1000 + delayTime * introArray.length;
  let isBlocking = true;

  let setBlockingStateTimeout: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const toNextIntroElement = () => {
    const introContainer = document.getElementById('introContainer');
    // 由于用户操作，相当于时间向前推进，这时候更新这个演出的预计完成时间
    baseDuration -= delayTime;
    if (setBlockingStateTimeout) clearTimeout(setBlockingStateTimeout);
    setBlockingStateTimeout = setTimeout(() => {
      isBlocking = false;
    }, baseDuration);
    if (introContainer) {
      const children = introContainer.childNodes[0].childNodes[0].childNodes as any;
      const len = children.length;
      if (isUserForward) {
        let isEnd = true;
        for (const node of children) {
          // 当前语句的延迟显示时间
          const currentDelay = Number(node.style.animationDelay.split('ms')[0]);
          // 当前语句还没有显示，降低显示延迟，因为现在时间因为用户操作，相当于向前推进了
          if (currentDelay > 0) {
            isEnd = false;
            // 用 Animation API 操作，浏览器版本太低就无办法了
            const nodeAnimations = node.getAnimations();
            node.style.animationDelay = '0ms ';
            for (const ani of nodeAnimations) {
              ani.currentTime = 0;
              ani.play();
            }
          }
        }
        if (isEnd) {
          if (timeout) clearTimeout(timeout);
          if (setBlockingStateTimeout) clearTimeout(setBlockingStateTimeout);
          WebGAL.gameplay.performController.unmountPerform(performName);
        }
        return;
      }
      children.forEach((node: HTMLDivElement, index: number) => {
        // 当前语句的延迟显示时间
        const currentDelay = Number(node.style.animationDelay.split('ms')[0]);
        // 当前语句还没有显示，降低显示延迟，因为现在时间因为用户操作，相当于向前推进了
        if (currentDelay > 0) {
          node.style.animationDelay = `${currentDelay - delayTime}ms`;
        }
        // 最后一个元素了
        if (index === len - 1) {
          // 并且已经完全显示了，这时候进行下一步
          if (currentDelay === 0) {
            if (timeout) clearTimeout(timeout);
            WebGAL.gameplay.performController.unmountPerform(performName);
            // 卸载函数发生在 nextSentence 生效前，所以不需要做下一行的操作。
            // setTimeout(nextSentence, 0);
          } else {
            // 还没有完全显示，但是因为时间的推进，要提前完成演出，更新用于结束演出的计时器
            if (timeout) clearTimeout(timeout);
            // 如果 Hold 了，自然不要自动结束
            if (!isHold) {
              timeout = setTimeout(() => {
                WebGAL.gameplay.performController.unmountPerform(performName);
              }, baseDuration);
            }
          }
        }
      });
    }
  };

  return {
    performName,
    duration,
    isHoldOn: false,
    startFunction: () => {
      isBlocking = true;
      setBlockingStateTimeout = setTimeout(() => {
        isBlocking = false;
      }, baseDuration);
      WebGAL.events.userInteractNext.on(toNextIntroElement);
      renderReact(intro, document.getElementById('introContainer'));
      const introContainer = document.getElementById('introContainer');

      if (introContainer) {
        introContainer.style.display = 'block';
      }
    },
    stopFunction: () => {
      const introContainer = document.getElementById('introContainer');
      if (introContainer) {
        introContainer.style.display = 'none';
      }
      unmountReact(introContainer);
      if (timeout) clearTimeout(timeout);
      if (setBlockingStateTimeout) clearTimeout(setBlockingStateTimeout);
      WebGAL.events.userInteractNext.off(toNextIntroElement);
    },
    blockingNext: () => isBlocking,
    blockingAuto: () => isBlocking,
    goNextWhenOver: true,
  };
};
