import { breakdown, type Denom } from './denoms.js'

export interface FlyChipsOpts {
  count?: number
  dur?: number
  spread?: number
  w?: number
  /**
   * 测量元素位置的函数，默认 el.getBoundingClientRect()。
   * jsdom 不实现布局，getBoundingClientRect 恒返回全 0 —— 单测中可以
   * 注入这个函数来提供确定的坐标，从而在不依赖真实布局的情况下
   * 断言飞行轨迹；不注入时逻辑仍然正确，只是位移都是 0（视觉上无差别，
   * 因为 jsdom 本来就不渲染）。
   */
  measure?: (el: Element) => { left: number; top: number; width: number; height: number }
  /** 每枚筹码之间的错峰延迟（ms），默认 45。注入更小的值可以让测试更快跑完。 */
  stagger?: number
  /** 随机函数，默认 Math.random；单测可注入以获得确定的抖动。 */
  random?: () => number
}

const defaultMeasure = (el: Element) => el.getBoundingClientRect()

/**
 * 筹码飞行动画：从 fromEl 飞往 toEl，落地后 resolve 实际飞出的面额构成。
 * 元素本体不旋转，只有 --spin 变量转动条纹（约束 1）；
 * 位移靠 CSS transform 的 translate，不靠 rotate。
 */
export function flyChips(
  fromEl: Element,
  toEl: Element,
  amount: number,
  opts: FlyChipsOpts = {},
): Promise<Denom[]> {
  const {
    count = 5,
    dur = 520,
    spread = 26,
    w = 20,
    measure = defaultMeasure,
    stagger = 45,
    random = Math.random,
  } = opts
  const a = measure(fromEl)
  const b = measure(toEl)
  const chips = breakdown(amount, count)

  return new Promise((resolve) => {
    if (!chips.length) {
      resolve([])
      return
    }
    chips.forEach((c, i) => {
      const el = document.createElement('div')
      el.className = `chip3d ${c.cls} flyer`
      el.style.setProperty('--cw', w + 'px')
      el.style.setProperty('--spin', ((i * 61) % 360) + 'deg')
      el.style.left = a.left + a.width / 2 - w / 2 + 'px'
      el.style.top = a.top + a.height / 2 + 'px'
      document.body.appendChild(el)

      const jx = (random() - 0.5) * spread
      const jy = (random() - 0.5) * spread * 0.5
      const dx = b.left + b.width / 2 - w / 2 + jx - (a.left + a.width / 2 - w / 2)
      const dy = b.top + b.height / 2 + jy - (a.top + a.height / 2)

      const applyTransform = () => {
        el.style.transition = `transform ${dur}ms cubic-bezier(.25,.75,.35,1)`
        el.style.transitionDelay = i * stagger + 'ms'
        el.style.transform = `translate(${dx}px, ${dy}px)` // 不旋转本体
      }
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(applyTransform)
      } else {
        setTimeout(applyTransform, 0)
      }

      setTimeout(
        () => {
          el.remove()
          if (i === chips.length - 1) resolve(chips)
        },
        dur + i * stagger + 20,
      )
    })
  })
}
