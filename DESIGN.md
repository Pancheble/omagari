---
version: alpha
name: Omagari
description: Omagari 웹 앱의 디자인 시스템. Apple 웹사이트 분석(사진이 주인공인 화면, 하나뿐인 파란 강조색, 음수 자간의 SF Pro 제목)을 바탕으로, 1단계 앱 화면에 필요한 부품과 한글 글꼴을 더했다(이슈 #17).

colors:
  primary: "#0066cc"
  primary-focus: "#0071e3"
  primary-on-dark: "#2997ff"
  ink: "#1d1d1f"
  body: "#1d1d1f"
  body-on-dark: "#ffffff"
  body-muted: "#cccccc"
  ink-muted-80: "#333333"
  ink-muted-48: "#7a7a7a"
  text-secondary: "#636366"
  divider-soft: "#f0f0f0"
  divider: "#00000014"
  hairline: "#e0e0e0"
  canvas: "#ffffff"
  canvas-parchment: "#f5f5f7"
  surface-pearl: "#fafafc"
  surface-tile-1: "#272729"
  surface-tile-2: "#2a2a2c"
  surface-tile-3: "#252527"
  surface-black: "#000000"
  surface-chip-translucent: "#d2d2d7"
  chip: "#e8e8ed"
  hover: "#0000000a"
  selected: "#0000000f"
  selected-solid: "#e6e6e8"
  focus-ring: "#0071e33d"
  overlay: "#00000052"
  online: "#248a3d"
  away: "#c27c0e"
  dnd: "#d70015"
  offline: "#8e8e93"
  error: "#d70015"
  error-bg: "#fdeceb"
  warning: "#b25000"
  warning-bg: "#fff4e5"
  on-primary: "#ffffff"
  on-dark: "#ffffff"
  dark-window: "#1d1d1f"
  dark-panel: "#272729"
  dark-field: "#2a2a2c"
  dark-chip: "#3a3a3c"
  dark-text: "#ffffff"
  dark-text-secondary: "#a1a1a6"
  dark-line: "#ffffff24"
  dark-selected: "#ffffff14"
  dark-selected-solid: "#353537"
  dark-warning: "#ffb340"

typography:
  hero-display:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.07
    letterSpacing: -0.28px
  display-lg:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: 0
  display-md:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: -0.374px
  lead:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.14
    letterSpacing: 0.196px
  lead-airy:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 24px
    fontWeight: 300
    lineHeight: 1.5
    letterSpacing: 0
  tagline:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 21px
    fontWeight: 600
    lineHeight: 1.19
    letterSpacing: 0.231px
  body-strong:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.24
    letterSpacing: -0.374px
  body:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: -0.374px
  dense-link:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 2.41
    letterSpacing: 0
  caption:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: -0.224px
  caption-strong:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.29
    letterSpacing: -0.224px
  button-large:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 18px
    fontWeight: 300
    lineHeight: 1.0
    letterSpacing: 0
  button-utility:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.29
    letterSpacing: -0.224px
  fine-print:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: 0
  micro-legal:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 0
  nav-link:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: 0
  app-title:
    fontFamily: "IBM Plex Sans KR, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0
  app-heading:
    fontFamily: "IBM Plex Sans KR, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.24
    letterSpacing: 0
  app-body:
    fontFamily: "IBM Plex Sans KR, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: 0
  app-body-strong:
    fontFamily: "IBM Plex Sans KR, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  app-answer:
    fontFamily: "IBM Plex Sans KR, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
  app-caption:
    fontFamily: "IBM Plex Sans KR, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.38
    letterSpacing: 0
  app-micro:
    fontFamily: "IBM Plex Sans KR, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: 0
  app-section:
    fontFamily: "IBM Plex Sans KR, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: 0
  app-mark:
    fontFamily: "IBM Plex Sans KR, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.0
    letterSpacing: 0
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  mono-small:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: 0

rounded:
  none: 0px
  xs: 5px
  sm: 8px
  md: 11px
  lg: 18px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 80px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body.fontSize}"
    fontWeight: "{typography.body.fontWeight}"
    lineHeight: "{typography.body.lineHeight}"
    rounded: "{rounded.pill}"
    padding: 11px 22px
  button-primary-focus:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
  button-primary-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
  button-secondary-pill:
    backgroundColor: transparent
    borderColor: "{colors.primary}"
    textColor: "{colors.primary}"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body.fontSize}"
    fontWeight: "{typography.body.fontWeight}"
    lineHeight: "{typography.body.lineHeight}"
    rounded: "{rounded.pill}"
    padding: 11px 22px
  button-dark-utility:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    fontFamily: "{typography.button-utility.fontFamily}"
    fontSize: "{typography.button-utility.fontSize}"
    fontWeight: "{typography.button-utility.fontWeight}"
    lineHeight: "{typography.button-utility.lineHeight}"
    rounded: "{rounded.sm}"
    padding: 8px 15px
  button-pearl-capsule:
    backgroundColor: "{colors.surface-pearl}"
    textColor: "{colors.ink-muted-80}"
    fontFamily: "{typography.caption.fontFamily}"
    fontSize: "{typography.caption.fontSize}"
    fontWeight: "{typography.caption.fontWeight}"
    lineHeight: "{typography.caption.lineHeight}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-store-hero:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    fontFamily: "{typography.button-large.fontFamily}"
    fontSize: "{typography.button-large.fontSize}"
    fontWeight: "{typography.button-large.fontWeight}"
    lineHeight: "{typography.button-large.lineHeight}"
    rounded: "{rounded.pill}"
    padding: 14px 28px
  button-icon-circular:
    backgroundColor: "{colors.surface-chip-translucent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 44px
  text-link:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body.fontSize}"
    fontWeight: "{typography.body.fontWeight}"
    lineHeight: "{typography.body.lineHeight}"
  text-link-on-dark:
    backgroundColor: transparent
    textColor: "{colors.primary-on-dark}"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body.fontSize}"
    fontWeight: "{typography.body.fontWeight}"
    lineHeight: "{typography.body.lineHeight}"
  global-nav:
    backgroundColor: "{colors.surface-black}"
    textColor: "{colors.on-dark}"
    fontFamily: "{typography.nav-link.fontFamily}"
    fontSize: "{typography.nav-link.fontSize}"
    fontWeight: "{typography.nav-link.fontWeight}"
    lineHeight: "{typography.nav-link.lineHeight}"
    height: 44px
  sub-nav-frosted:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.tagline.fontFamily}"
    fontSize: "{typography.tagline.fontSize}"
    fontWeight: "{typography.tagline.fontWeight}"
    lineHeight: "{typography.tagline.lineHeight}"
    backdropFilter: saturate(180%) blur(20px)
    height: 52px
  product-tile-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.display-lg.fontFamily}"
    fontSize: "{typography.display-lg.fontSize}"
    fontWeight: "{typography.display-lg.fontWeight}"
    lineHeight: "{typography.display-lg.lineHeight}"
    rounded: "{rounded.none}"
    padding: 80px
  product-tile-parchment:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.display-lg.fontFamily}"
    fontSize: "{typography.display-lg.fontSize}"
    fontWeight: "{typography.display-lg.fontWeight}"
    lineHeight: "{typography.display-lg.lineHeight}"
    rounded: "{rounded.none}"
    padding: 80px
  product-tile-dark:
    backgroundColor: "{colors.surface-tile-1}"
    textColor: "{colors.on-dark}"
    fontFamily: "{typography.display-lg.fontFamily}"
    fontSize: "{typography.display-lg.fontSize}"
    fontWeight: "{typography.display-lg.fontWeight}"
    lineHeight: "{typography.display-lg.lineHeight}"
    rounded: "{rounded.none}"
    padding: 80px
  product-tile-dark-2:
    backgroundColor: "{colors.surface-tile-2}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
  product-tile-dark-3:
    backgroundColor: "{colors.surface-tile-3}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
  store-utility-card:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.body-strong.fontFamily}"
    fontSize: "{typography.body-strong.fontSize}"
    fontWeight: "{typography.body-strong.fontWeight}"
    lineHeight: "{typography.body-strong.lineHeight}"
    rounded: "{rounded.lg}"
    padding: 24px
  configurator-option-chip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.caption.fontFamily}"
    fontSize: "{typography.caption.fontSize}"
    fontWeight: "{typography.caption.fontWeight}"
    lineHeight: "{typography.caption.lineHeight}"
    rounded: "{rounded.pill}"
    padding: 12px 16px
  configurator-option-chip-selected:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.primary-focus}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  search-input:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body.fontSize}"
    fontWeight: "{typography.body.fontWeight}"
    lineHeight: "{typography.body.lineHeight}"
    rounded: "{rounded.pill}"
    padding: 12px 20px
    height: 44px
  floating-sticky-bar:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body.fontSize}"
    fontWeight: "{typography.body.fontWeight}"
    lineHeight: "{typography.body.lineHeight}"
    backdropFilter: saturate(180%) blur(20px)
    height: 64px
    padding: 12px 32px
  environment-quote-card:
    backgroundColor: "{colors.surface-tile-1}"
    textColor: "{colors.on-dark}"
    fontFamily: "{typography.display-lg.fontFamily}"
    fontSize: "{typography.display-lg.fontSize}"
    fontWeight: "{typography.display-lg.fontWeight}"
    lineHeight: "{typography.display-lg.lineHeight}"
    rounded: "{rounded.none}"
    padding: 80px
  footer:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink-muted-80}"
    fontFamily: "{typography.fine-print.fontFamily}"
    fontSize: "{typography.fine-print.fontSize}"
    fontWeight: "{typography.fine-print.fontWeight}"
    lineHeight: "{typography.fine-print.lineHeight}"
    padding: 64px

  app-window:
    backgroundColor: "{colors.canvas}"
    padding: 8px
  app-side-panel:
    backgroundColor: "{colors.canvas-parchment}"
    borderColor: "{colors.selected}"
    rounded: "{rounded.lg}"
    padding: 14px 8px 8px
    width: 240px
  app-right-panel:
    backgroundColor: "{colors.canvas-parchment}"
    borderColor: "{colors.selected}"
    rounded: "{rounded.lg}"
    padding: 14px 8px 8px
    width: 300px
  app-channel-header:
    textColor: "{colors.ink}"
    borderColor: "{colors.divider}"
    fontFamily: "{typography.app-title.fontFamily}"
    fontSize: "{typography.app-title.fontSize}"
    fontWeight: "{typography.app-title.fontWeight}"
    lineHeight: "{typography.app-title.lineHeight}"
    height: 52px
  app-header-button:
    backgroundColor: transparent
    textColor: "{colors.text-secondary}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    fontWeight: "{typography.app-caption.fontWeight}"
    lineHeight: "{typography.app-caption.lineHeight}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: 0 10px
  app-header-button-pressed:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    iconColor: "{colors.primary}"
    rounded: "{rounded.sm}"
  app-section-title:
    textColor: "{colors.text-secondary}"
    fontFamily: "{typography.app-section.fontFamily}"
    fontSize: "{typography.app-section.fontSize}"
    fontWeight: "{typography.app-section.fontWeight}"
    lineHeight: "{typography.app-section.lineHeight}"
  app-nav-item:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    iconColor: "{colors.text-secondary}"
    fontFamily: "{typography.app-body.fontFamily}"
    fontSize: "{typography.app-body.fontSize}"
    fontWeight: "{typography.app-body.fontWeight}"
    lineHeight: "{typography.app-body.lineHeight}"
    rounded: "{rounded.sm}"
    height: 30px
    padding: 0 10px
  app-nav-item-hover:
    backgroundColor: "{colors.hover}"
    rounded: "{rounded.sm}"
  app-nav-item-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    iconColor: "{colors.primary}"
    fontWeight: "{typography.app-body-strong.fontWeight}"
    rounded: "{rounded.sm}"
  app-profile-panel:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body-strong.fontFamily}"
    fontSize: "{typography.app-body-strong.fontSize}"
    fontWeight: "{typography.app-body-strong.fontWeight}"
    lineHeight: "{typography.app-body-strong.lineHeight}"
    rounded: "{rounded.md}"
    padding: 4px
  app-member-row:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body-strong.fontFamily}"
    fontSize: "{typography.app-body-strong.fontSize}"
    fontWeight: "{typography.app-body-strong.fontWeight}"
    lineHeight: "{typography.app-body-strong.lineHeight}"
    rounded: "{rounded.md}"
    padding: 6px 8px
  app-member-row-open:
    backgroundColor: "{colors.selected}"
    rounded: "{rounded.md}"
  app-member-status:
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    fontWeight: "{typography.app-caption.fontWeight}"
    lineHeight: "{typography.app-caption.lineHeight}"
  app-work-line:
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    fontWeight: "{typography.app-caption.fontWeight}"
    lineHeight: "{typography.app-caption.lineHeight}"
  app-avatar-person:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 40px
  app-agent-mark:
    backgroundColor: "{colors.surface-tile-1}"
    textColor: "{colors.on-dark}"
    fontFamily: "{typography.app-mark.fontFamily}"
    fontSize: "{typography.app-mark.fontSize}"
    fontWeight: "{typography.app-mark.fontWeight}"
    lineHeight: "{typography.app-mark.lineHeight}"
    rounded: "{rounded.xs}"
    size: 20px
  app-presence-online:
    backgroundColor: "{colors.online}"
    rounded: "{rounded.full}"
    size: 12px
  app-presence-away:
    backgroundColor: "{colors.away}"
    rounded: "{rounded.full}"
    size: 12px
  app-presence-dnd:
    backgroundColor: "{colors.dnd}"
    rounded: "{rounded.full}"
    size: 12px
  app-presence-offline:
    backgroundColor: transparent
    borderColor: "{colors.offline}"
    rounded: "{rounded.full}"
    size: 12px
  app-message:
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body.fontFamily}"
    fontSize: "{typography.app-body.fontSize}"
    fontWeight: "{typography.app-body.fontWeight}"
    lineHeight: "{typography.app-body.lineHeight}"
    padding: 6px 20px
    maxWidth: 720px
  app-message-time:
    textColor: "{colors.text-secondary}"
    fontFamily: "{typography.app-micro.fontFamily}"
    fontSize: "{typography.app-micro.fontSize}"
    fontWeight: "{typography.app-micro.fontWeight}"
    lineHeight: "{typography.app-micro.lineHeight}"
  app-qa-line:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    fontWeight: "{typography.app-caption.fontWeight}"
    lineHeight: "{typography.app-caption.lineHeight}"
    rounded: "{rounded.pill}"
    height: 36px
    padding: 6px 12px 6px 8px
  app-qa-card:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-answer.fontFamily}"
    fontSize: "{typography.app-answer.fontSize}"
    fontWeight: "{typography.app-answer.fontWeight}"
    lineHeight: "{typography.app-answer.lineHeight}"
    rounded: "{rounded.lg}"
    padding: 16px
  app-composer:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body.fontFamily}"
    fontSize: "{typography.app-body.fontSize}"
    fontWeight: "{typography.app-body.fontWeight}"
    lineHeight: "{typography.app-body.lineHeight}"
    rounded: "{rounded.lg}"
    padding: 6px 6px 6px 16px
    maxHeight: 200px
  app-composer-disabled:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.lg}"
  app-send-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    size: 32px
  app-text-input:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body.fontFamily}"
    fontSize: "{typography.app-body.fontSize}"
    fontWeight: "{typography.app-body.fontWeight}"
    lineHeight: "{typography.app-body.lineHeight}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  app-text-input-focus:
    borderColor: "{colors.primary}"
    ringColor: "{colors.focus-ring}"
    rounded: "{rounded.md}"
  app-text-input-error:
    borderColor: "{colors.error}"
    helpColor: "{colors.error}"
    rounded: "{rounded.md}"
  app-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: 14px
    fontWeight: "{typography.app-caption.fontWeight}"
    rounded: "{rounded.pill}"
    height: 32px
    padding: 0 14px
  app-button-outline:
    backgroundColor: transparent
    borderColor: "{colors.primary}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    height: 32px
    padding: 0 14px
  app-button-quiet:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: 32px
    padding: 0 14px
  app-button-danger:
    backgroundColor: transparent
    textColor: "{colors.error}"
    rounded: "{rounded.pill}"
    height: 32px
    padding: 0 14px
  app-button-disabled:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
  app-badge:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-micro.fontFamily}"
    fontSize: "{typography.app-micro.fontSize}"
    fontWeight: "{typography.app-micro.fontWeight}"
    lineHeight: 1.0
    rounded: "{rounded.pill}"
    height: 20px
    padding: 0 8px
  app-badge-outline:
    backgroundColor: transparent
    borderColor: "{colors.hairline}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    height: 20px
  app-badge-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    rounded: "{rounded.pill}"
    height: 20px
  app-banner-info:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    fontWeight: "{typography.app-caption.fontWeight}"
    lineHeight: "{typography.app-caption.lineHeight}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  app-banner-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    rounded: "{rounded.md}"
    height: 36px
  app-banner-error:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.error}"
    rounded: "{rounded.md}"
    height: 36px
  app-popover:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    shadow: 0 8px 24px #0000001f
    rounded: "{rounded.md}"
    padding: 6px
  app-menu-item:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: 14px
    fontWeight: "{typography.app-caption.fontWeight}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: 0 8px
  app-dialog:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    shadow: 0 8px 24px #0000001f
    overlayColor: "{colors.overlay}"
    rounded: "{rounded.lg}"
    padding: 24px
    width: 400px
  app-tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    fontFamily: "{typography.app-micro.fontFamily}"
    fontSize: "{typography.app-micro.fontSize}"
    fontWeight: "{typography.app-micro.fontWeight}"
    lineHeight: "{typography.app-micro.lineHeight}"
    rounded: "{rounded.xs}"
    padding: 4px 8px
  app-skeleton:
    backgroundColor: "{colors.chip}"
    rounded: "{rounded.xs}"
  app-code-inline:
    backgroundColor: "{colors.canvas-parchment}"
    fontFamily: "{typography.mono.fontFamily}"
    fontSize: "{typography.mono.fontSize}"
    fontWeight: "{typography.mono.fontWeight}"
    rounded: "{rounded.xs}"
    padding: 1px 5px
  app-code-block:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.mono.fontFamily}"
    fontSize: "{typography.mono.fontSize}"
    fontWeight: "{typography.mono.fontWeight}"
    lineHeight: "{typography.mono.lineHeight}"
    rounded: "{rounded.md}"
    padding: 12px 14px
  app-source-ref:
    textColor: "{colors.text-secondary}"
    fontFamily: "{typography.mono-small.fontFamily}"
    fontSize: "{typography.mono-small.fontSize}"
    fontWeight: "{typography.mono-small.fontWeight}"
    lineHeight: "{typography.mono-small.lineHeight}"
---

## Overview

Apple's web presence is a masterclass in **reverent product photography framed by near-invisible UI**. Every page is a stack of edge-to-edge product "tiles" — alternating light and dark canvases, each centered on a hero headline, a one-line tagline, two tiny blue pill CTAs, and an impossibly crisp product render. Nothing competes with the product. Typography is confident but quiet; color is either pure white, an off-white parchment, or a near-black tile; interactive elements are a single, quiet blue.

Density is unusually low even by contemporary SaaS standards. Each tile occupies roughly one viewport, and there is no decorative chrome — no borders, no gradients, no decorative frames, no shadows on headlines. Elevation appears only when a product image rests on a surface (a single soft `rgba(0, 0, 0, 0.22) 3px 5px 30px` drop for visual weight). The result is a catalog that feels more like a museum gallery: the wall disappears and the artifact takes over.

Store and shop surfaces retain the same chassis but switch modes. The product configurator (iPhone 17 Pro, accessories grid) introduces a tight grid of white utility cards at `{rounded.lg}` (18px) radius with a thin border, paired with a persistent thin sub-nav strip. The environment page leans darker and more editorial. Across all five surfaces the typographic system, spacing rhythm, and the single blue accent are consistent — this is one design language expressed at different volumes.

**Key Characteristics:**
- Photography-first presentation; UI recedes so the product can speak.
- Alternating full-bleed tile sections: white/parchment ↔ near-black, with the color change itself acting as the section divider.
- Single blue accent (`{colors.primary}` — #0066cc) carries every interactive element. No second brand color exists.
- Two button grammars: tiny blue pill CTAs (`{rounded.pill}`) and compact utility rects (`{rounded.sm}`).
- SF Pro Display + SF Pro Text — negative letter-spacing at display sizes for the signature "Apple tight" headline feel.
- Whisper-soft elevation used only when a product image needs to breathe — exactly one drop-shadow in the entire system.
- Tight two-row nav: slim `{component.global-nav}` + product-specific `{component.sub-nav-frosted}` with persistent right-aligned primary CTA.
- Section rhythm across multiple pages: light hero → dark product tile → light utility tile → dark tile → parchment footer — a predictable pulse.

### Omagari 앱

위의 분석은 Apple 마케팅 사이트에서 왔다. Omagari 앱 화면은 같은 바탕(흰 바탕과 파치먼트, 하나뿐인 파란 강조색, 장식 없는 표면)을 쓰되, 사람이 하루 종일 머무는 채팅 앱이라 밀도를 높였다. 아래 "앱" 소절들이 그 차이를 정한다. 앱 화면(`area:web`)에서 마케팅 값과 앱 값이 다르면 앱 값을 따른다.

이 소절들은 2026-11-11 이슈 #17에서 시안을 보고 정했다(시안 캔버스의 "정한 것" 페이지).

| 무엇 | 정한 것 |
| --- | --- |
| 앱 틀 | 떠 있는 패널 세 칸: 왼쪽 채널, 가운데 대화, 오른쪽 멤버 또는 내 에이전트 |
| 오른쪽 칸 | 멤버 목록과 내 에이전트(DM)는 채널 머리 띠의 별도 버튼으로 연다. 한 번에 하나만 열린다 |
| 멤버 목록 행 | 접힌 것이 기본. 이름 아래에 상태 메시지와 작업 수, 펼치면 작업 줄 |
| 에이전트 | 실행기마다 하나(ADR-0015). 사람 아래에 에이전트, 에이전트 표시는 실행기 약자 |
| 프로필 패널 | 왼쪽 아래. 아바타, 접속 상태, 이름, 상태 메시지. 누르면 상태 메뉴 |
| 글꼴 | IBM Plex Sans KR, 코드는 IBM Plex Mono. 한글 자간 0 |
| 메시지 | 목록형, 본문 15px |
| 문답 | 접힌 한 줄과 테두리 카드 |
| 어두운 모드 | 색 값만 정해 두고, 1단계 화면은 밝은 모드만 낸다 |

## Colors

> **Source pages analyzed:** homepage, environment, store, iPhone 17 Pro buy page, accessories index. The color system is identical across all five surfaces; only the surface-mode mix differs.

### Brand & Accent
- **Action Blue** (`{colors.primary}` — #0066cc): The single brand-level interactive color. All text links, all blue pill CTAs ("Learn more", "Buy"), and the focus ring root. This is Apple's quiet but universal "click me" signal. Press state shifts via the active scale transform rather than a hex change.
- **Focus Blue** (`{colors.primary-focus}` — #0071e3): A marginally brighter sibling of Action Blue, reserved for the keyboard focus ring on buttons (`outline: 2px solid`).
- **Sky Link Blue** (`{colors.primary-on-dark}` — #2997ff): A brighter blue used on dark surfaces for in-copy links and inline callouts, where Action Blue would disappear against the tile background.

### Surface
- **Pure White** (`{colors.canvas}` — #ffffff): The dominant canvas. Content, utility cards, store tiles, configurator grids.
- **Parchment** (`{colors.canvas-parchment}` — #f5f5f7): The signature Apple off-white. Used for alternating light tiles, footer region, and the default page canvas in store utility sections. Just different enough from white to create rhythm.
- **Pearl Button** (`{colors.surface-pearl}` — #fafafc): A near-white used as the fill for secondary "ghost" buttons — lighter than the parchment canvas so the button still reads as a button against `{colors.canvas-parchment}`.
- **Near-Black Tile 1** (`{colors.surface-tile-1}` — #272729): The primary dark-tile surface on the homepage product grid.
- **Near-Black Tile 2** (`{colors.surface-tile-2}` — #2a2a2c): A micro-step lighter — used where a dark tile sits directly above or below Tile 1 to create the faintest separation.
- **Near-Black Tile 3** (`{colors.surface-tile-3}` — #252527): A micro-step darker — used at the bottom of the stack and in embedded video/player frames.
- **Pure Black** (`{colors.surface-black}` — #000000): Reserved for true void — video player backgrounds, edge-to-edge photographic overlays, the global nav bar background.
- **Translucent Chip Gray** (`{colors.surface-chip-translucent}` — #d2d2d7): The base hex of the translucent gray chip used over photography for circular control buttons, applied at 64% alpha as `rgba(210, 210, 215, 0.64)`.

### Text
- **Near-Black Ink** (`{colors.ink}` — #1d1d1f): The voice of every headline, every body paragraph, and the dark utility button's fill. Chosen instead of pure black to keep the page feeling photographic rather than printed.
- **Body** (`{colors.body}` — #1d1d1f): Same hex as ink — Apple uses one near-black tone for all text on light surfaces.
- **Body On Dark** (`{colors.body-on-dark}` — #ffffff): All text on dark tiles and on the global nav bar.
- **Body Muted** (`{colors.body-muted}` — #cccccc): Secondary copy on dark tiles where pure white would be too loud.
- **Ink Muted 80** (`{colors.ink-muted-80}` — #333333): Body text on the white Pearl Button surface — slightly softer than pure black.
- **Ink Muted 48** (`{colors.ink-muted-48}` — #7a7a7a): Disabled button text and legal fine-print on marketing pages only. It reaches 4.28:1 on white, under the 4.5:1 that small text needs, so the app uses `{colors.text-secondary}` instead.

### Hairlines & Borders
- **Hairline** (`{colors.hairline}` — #e0e0e0): The 1px border on cards, inputs, chips, and popovers. One border color for every bordered surface.
- **Divider** (`{colors.divider}` — `rgba(0, 0, 0, 0.08)`): Separators that are not borders: the line under a header bar, the line between list rows, the edge of a frosted bar.
- **Divider Soft** (`{colors.divider-soft}` — #f0f0f0): Only the 3px soft ring on `{component.button-pearl-capsule}`.

### Brand Gradient
**No decorative gradients.** Atmospheric depth on product photography (the iPhone 17 Pro camera plate, the Apple Watch bands, AirPods reflections) is inherent to the imagery, not a CSS gradient overlay. The environment page's hero uses photographic atmosphere (mountain vista at dawn) but no gradient tokens are defined. Apple is the rare luxury-brand site with zero gradient-based design tokens.

### 앱에서 더한 색

- **보조 글씨** (`{colors.text-secondary}` — #636366): 시각, 브랜치, 섹션 제목, 설명 같은 작은 보조 글씨. 흰 바탕 6.0:1, 파치먼트 5.5:1, 고른 줄 바탕에서도 4.5:1을 넘는다.
- **줄 상태**: 올렸을 때 `{colors.hover}`(검정 4%), 고른 것 `{colors.selected}`(검정 6%). 투명 위에 겹치는 색이라, 겹친 결과를 한 색으로 써야 할 때(접속 점 둘레 고리)는 `{colors.selected-solid}`를 쓴다.
- **접속 상태**: 온라인 `{colors.online}` #248a3d, 자리 비움 `{colors.away}` #c27c0e, 방해 금지 `{colors.dnd}` #d70015, 오프라인 `{colors.offline}` #8e8e93. 색만이 아니라 점의 모양으로도 가른다(부품 "접속 점").
- **오류와 경고**: 오류 `{colors.error}` #d70015 / 바탕 `{colors.error-bg}`, 경고 `{colors.warning}` #b25000 / 바탕 `{colors.warning-bg}`. 둘 다 바탕 위 글씨가 4.5:1을 넘는다.
- **칩과 뼈대**: `{colors.chip}` #e8e8ed는 아바타 바탕, 비공개 배지, 막힌 버튼, 불러오는 중의 회색 막대에 쓴다.
- **덮개와 고리**: 대화 상자 뒤 덮개 `{colors.overlay}`(검정 32%), 입력 칸 포커스 고리 `{colors.focus-ring}`(Focus Blue 24%).
- **강조색은 그대로 하나다.** 접속 상태와 오류·경고의 색은 상태를 알리는 색이고, 누를 수 있다는 신호는 여전히 `{colors.primary}`만 낸다.

### 어두운 모드

어두운 모드의 색 값은 `dark-*` 토큰으로 정해 둔다. 1단계 화면은 밝은 모드만 내고, 시스템 설정을 따라가는 어두운 모드는 뒤로 미룬다.

| 역할 | 밝게 | 어둡게 |
| --- | --- | --- |
| 창 바탕 | `{colors.canvas}` | `{colors.dark-window}` #1d1d1f |
| 패널 | `{colors.canvas-parchment}` | `{colors.dark-panel}` #272729 |
| 입력 칸 | `{colors.canvas}` | `{colors.dark-field}` #2a2a2c |
| 칩 | `{colors.chip}` | `{colors.dark-chip}` #3a3a3c |
| 글씨 | `{colors.ink}` | `{colors.dark-text}` #ffffff |
| 보조 글씨 | `{colors.text-secondary}` | `{colors.dark-text-secondary}` #a1a1a6 |
| 선 | `{colors.hairline}` | `{colors.dark-line}` (흰색 14%) |
| 고른 줄 | `{colors.selected}` | `{colors.dark-selected}` (흰색 8%) |
| 경고 글씨 | `{colors.warning}` | `{colors.dark-warning}` #ffb340 |

어두운 바탕의 강조 아이콘은 `{colors.primary-on-dark}`를 쓴다. 그 파랑은 작은 글씨로는 4.5:1이 안 되므로, 고른 줄의 이름 같은 글씨는 흰색으로 두고 아이콘만 파랗게 한다.

## Typography

### Font Family
- **Display**: `SF Pro Display, system-ui, -apple-system, sans-serif` — Apple's proprietary display face, optimized for sizes ≥ 19px. Defines the voice of every headline.
- **Body / UI**: `SF Pro Text, system-ui, -apple-system, sans-serif` — the text-optimized variant used for body copy, captions, buttons, and links below 20px.
- **OpenType features**: `font-variant-numeric: numerator` is enabled on numeric links (pricing tables, spec sheets). Display sizes rely on tight tracking rather than contextual ligatures.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.hero-display}` | 56px | 600 | 1.07 | -0.28px | Hero headline; the signature "Apple tight" tracking |
| `{typography.display-lg}` | 40px | 600 | 1.10 | 0 | Tile headlines atop every product tile |
| `{typography.display-md}` | 34px | 600 | 1.18 | -0.374px | Section heads (SF Pro Text at display proportions) |
| `{typography.lead}` | 28px | 400 | 1.14 | 0.196px | Product tile subcopy |
| `{typography.lead-airy}` | 24px | 300 | 1.5 | 0 | Environment-page lead paragraphs (the rare weight 300) |
| `{typography.tagline}` | 21px | 600 | 1.19 | 0.231px | Sub-tile tagline; sub-nav category name |
| `{typography.body-strong}` | 17px | 600 | 1.24 | -0.374px | Inline strong emphasis |
| `{typography.body}` | 17px | 400 | 1.47 | -0.374px | Default paragraph |
| `{typography.dense-link}` | 17px | 400 | 2.41 | 0 | Footer / store utility link lists (relaxed leading) |
| `{typography.caption}` | 14px | 400 | 1.43 | -0.224px | Secondary captions, button text |
| `{typography.caption-strong}` | 14px | 600 | 1.29 | -0.224px | Emphasized captions |
| `{typography.button-large}` | 18px | 300 | 1.0 | 0 | Store hero CTAs (the rare weight 300) |
| `{typography.button-utility}` | 14px | 400 | 1.29 | -0.224px | Utility/nav button labels |
| `{typography.fine-print}` | 12px | 400 | 1.0 | 0 | Fine-print, footer body |
| `{typography.micro-legal}` | 10px | 400 | 1.3 | 0 | Micro legal disclaimers |
| `{typography.nav-link}` | 12px | 400 | 1.0 | 0 | Global nav menu items |

### Principles

- **Negative letter-spacing at display sizes.** Headlines at 17px and up carry a slight tracking tighten (`-0.224 → -0.374px`). This produces the iconic "Apple tight" headline cadence. Never used at 12px or below.
- **Body copy at 17px, not 16px.** Apple breaks the SaaS convention and runs paragraph text at 17px. The extra pixel gives the page an unmistakable "reading, not scanning" pace. (The app runs denser; see 앱 글꼴.)
- **Weight 300 is real and rare.** Used deliberately on a handful of large-size reads (`{typography.button-large}` at 18px/300 and `{typography.lead-airy}` at 24px/300). It's a light-atmosphere cue reserved for moments where the content should feel airy.
- **Weight 600 for headlines and the tagline.** The ladder is 300 / 400 / 600. Weight 500 and 700 are not used.
- **Line-height is context-specific.** Display sizes use 1.07–1.19 (tight). Body uses 1.47. Utility link stacks in the footer/store use an unusually relaxed 2.41 (`{typography.dense-link}`). The 2.41 is how the footer's dense link columns breathe.

### Note on Font Substitutes
SF Pro is Apple's proprietary system font. When building off-system:

- Use `system-ui, -apple-system, BlinkMacSystemFont` as the first stack entry — on macOS/iOS/Safari this resolves to the real SF Pro.
- For non-Apple platforms, **Inter** (Google Fonts, variable) is the closest open-source equivalent. Inter at weight 600 with `font-feature-settings: "ss03"` approximates SF Pro's rounded "a" character.
- Nudge `letter-spacing` down by `-0.01em` on display sizes to re-create the Apple tight feel; Inter's default tracking runs slightly wider than SF Pro.
- For body text, tighten line-height by `0.03` (from 1.47 → 1.44) when substituting Inter — Inter's taller x-height needs less leading.

### 앱 글꼴과 한글

- **글꼴**: 앱은 **IBM Plex Sans KR**(400, 600)을 쓰고, 코드와 브랜치·커밋은 **IBM Plex Mono**(400)를 쓴다. 둘 다 SIL Open Font License라 Google Fonts에서 받거나 직접 호스팅한다. 운영체제마다 글꼴이 바뀌지 않게, 시스템 글꼴은 받지 못했을 때의 대체로만 둔다.
- **자간**: 한글이 섞인 앱 글씨는 자간을 0으로 둔다. 한글은 자간을 줄이면 글자가 붙어 읽기 어려워진다. 음수 자간은 마케팅 화면의 21px 이상 라틴 제목에만 쓴다.
- **크기**: 앱 본문은 15px이다. 채팅 앱은 한 화면에 보이는 대화가 많아야 해서 마케팅 본문 17px보다 작게 잡는다. 대신 위계가 납작해지지 않게 채널 제목은 20px로 올린다(본문과 1.33배 차이).
- **11px 아래로 쓰지 않는다.** 이름, 표시, 시각, 배지처럼 읽어야 하는 글씨는 11px 이상이다. 에이전트 표시(`CC`, `CX`)도 11px이고, 그래서 표시 상자는 20px보다 작게 만들지 않는다.

| Token | Size | Weight | Line Height | 쓰는 곳 |
| --- | --- | --- | --- | --- |
| `{typography.app-title}` | 20px | 600 | 1.2 | 채널 머리 띠의 채널 이름 |
| `{typography.app-heading}` | 17px | 600 | 1.24 | 워크스페이스 이름, 대화 상자 제목 |
| `{typography.app-body}` | 15px | 400 | 1.47 | 메시지, 채널 줄, 입력 칸 |
| `{typography.app-body-strong}` | 15px | 600 | 1.3 | 사람 이름, 고른 채널 |
| `{typography.app-answer}` | 15px | 400 | 1.6 | 에이전트의 답(마크다운) |
| `{typography.app-caption}` | 13px | 400 | 1.38 | 상태 메시지, 작업 줄, 접힌 문답, 알림 띠 |
| `{typography.app-micro}` | 12px | 400 | 1.33 | 시각, 브랜치, 배지, 툴팁, 도움말 |
| `{typography.app-section}` | 12px | 600 | 1.33 | 섹션 제목("채널", "온라인 — 3") |
| `{typography.app-mark}` | 11px | 600 | 1.0 | 에이전트 표시 |
| `{typography.mono}` | 13px | 400 | 1.55 | 코드 블록, 인라인 코드 |
| `{typography.mono-small}` | 12px | 400 | 1.33 | 답이 본 브랜치와 커밋 |

## Layout

### Spacing System
- **Base unit:** 8px. Sub-base values (2, 4, 6) are used for tight typographic adjustments; structural layout snaps to 4 / 8 / 12 / 16 / 24 / 32.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 80px. (`{spacing.md}` was 17px in the source analysis, taken from the body line rhythm. It now sits on the 8px grid.)
- **Section vertical padding:** `{spacing.section}` (80px) inside a product tile; tiles stack edge-to-edge with 0 gap (the color change provides the break).
- **Card padding:** `{spacing.lg}` (24px) inside utility grid cards.
- **Button padding:** 8–11px vertical, 15–22px horizontal, per component.
- **Universal rhythm constants:** the 17px body line-height multiplier (~25px line) and 21px tagline size show up on every analyzed page.

### Grid & Container
- **Max content width:** 980px on text-heavy sections (environment), 1440px on product grids (store, accessories), full-bleed for product tiles (homepage).
- **Column patterns:** 3 to 5 column utility card grid on store/accessories; 2-column side-by-side tiles on homepage occasional sections; single-column centered stack on product tile heroes.
- **Gutters:** 20–24px between cards in a utility grid.

### Whitespace Philosophy
Apple's whitespace is the product's pedestal. Every tile begins with at least 64px of air above its headline and 48–64px below. Product renders are never crowded; the nearest content to a product image is at least 40px away. The footer is the only area that breaks this — there, Apple goes deliberately dense to make the full information architecture visible at a glance.

### 앱 틀

- **창**: 창 바탕은 `{colors.canvas}`이고, 안쪽 8px 여백과 8px 간격으로 세 칸을 둔다. 왼쪽 채널 패널 240px, 가운데 대화 칸(남는 폭), 오른쪽 칸 300px이다.
- **떠 있는 패널**: 채널 패널과 오른쪽 칸은 `{component.app-side-panel}`, `{component.app-right-panel}`이다. 파치먼트 바탕, `{rounded.lg}` 18px, 안쪽 1px 선(검정 6%)을 쓴다. 대화 칸은 패널이 아니라 창 바탕 위에 바로 놓는다.
- **오른쪽 칸은 하나만**: 멤버 목록과 내 에이전트(DM) 가운데 하나만 열린다. 채널 머리 띠의 두 버튼으로 열고, 같은 버튼을 다시 누르면 닫힌다. 닫히면 대화 칸이 넓어진다.
- **대화 칸**: 위에서부터 머리 띠(52px, 아래에 `{colors.divider}` 선), 메시지 목록(아래로 쌓임), 입력 칸이다. 메시지 글줄은 720px을 넘지 않는다.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Full-bleed tiles, global nav, footer, body sections |
| Soft hairline | 1px `{colors.hairline}` border | Utility cards, inputs, chips, the Q&A card |
| Backdrop blur | `backdrop-filter: saturate(180%) blur(20px)` on Parchment 80% | Sub-nav and the iPhone buy floating sticky bar |
| Floating layer (앱) | 1px `{colors.hairline}` + `0 8px 24px rgba(0, 0, 0, 0.12)` | 메뉴, 상태 메뉴의 시간 고르기, 대화 상자 |
| Product shadow | `rgba(0, 0, 0, 0.22) 3px 5px 30px 0` | Product renders resting on a surface |

**Shadow philosophy.** Apple uses exactly one drop-shadow, and it is applied to photographic product imagery — never to cards, never to buttons, never to text. Elevation in the UI comes from (a) surface-color change (light tile ↔ dark tile) and (b) backdrop-blur on sticky bars. The single shadow is about giving the product weight, not about UI hierarchy.

**앱의 예외 하나.** 메뉴와 대화 상자처럼 다른 화면 위에 잠깐 떠 있는 층에만 그림자를 준다. 선만 두면 뒤 화면과 섞여 어디까지가 메뉴인지 흐려지기 때문이다. 카드, 패널, 버튼, 글씨에는 여전히 그림자를 주지 않는다.

### Decorative Depth
- **Atmospheric imagery** on the environment page (photographic vista) supplies mood; no CSS gradient involved.
- **Edge-to-edge tile alternation** creates rhythm without borders or shadows — the color change itself is the divider.
- **Backdrop-filter blur** on `{component.sub-nav-frosted}` and `{component.floating-sticky-bar}` creates a "floating over content" effect that's functional, not decorative.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Full-bleed product tiles (no corner rounding) |
| `{rounded.xs}` | 5px | 에이전트 표시, 인라인 코드, 툴팁, 불러오는 중의 막대 |
| `{rounded.sm}` | 8px | Dark utility buttons; 앱의 채널 줄, 머리 띠 버튼, 메뉴 줄 |
| `{rounded.md}` | 11px | Pearl Button capsules; 앱의 입력 칸, 코드 블록, 알림 띠, 메뉴, 프로필 패널, 멤버 목록 행 |
| `{rounded.lg}` | 18px | Store utility cards; 앱의 떠 있는 패널, 문답 카드, 메시지 입력 칸, 대화 상자 |
| `{rounded.pill}` | 9999px | Primary blue pill CTAs, search input; 앱의 버튼, 배지, 접힌 문답 |
| `{rounded.full}` | 9999px / 50% | Circular control chips; 사람 아바타, 접속 점, 보내기 버튼 |

### Photography Geometry
- **Hero imagery**: full-bleed, 21:9 or taller on the homepage; 16:9 on environment and shop pages. Product renders are photographic-realistic, often shot on a tinted surface that becomes the tile background.
- **Product renders**: PNG/WebP with transparency; rest on a surface tile and pick up the system shadow.
- **Accessory grid**: square 1:1 crops at `{rounded.lg}` (18px) radius, light neutral backgrounds, product centered with 20–40px internal padding.
- **No rounded imagery in hero tiles** — images are full-bleed rectangular. Rounding (`{rounded.sm}`, `{rounded.lg}`) appears only on inline card imagery.
- Lazy-loading via responsive `srcset` and `sizes` across all breakpoints; CDN-optimized WebP.

### 앱의 모양 규칙
- **사람은 동그라미, 에이전트는 둥근 네모.** 아바타 모양만 보고도 사람과 에이전트를 가른다.
- **아이콘**: Lucide(ISC 라이선스)를 쓴다. 선 굵기 1.5px, 16·18·20px 세 크기만 쓴다. 회사 로고와 이모지는 아이콘으로 쓰지 않는다(이모지는 사람이 쓴 상태 메시지 안에서만 쓴다).

## Components

### Top Navigation

**`global-nav`** — Persistent, ultra-thin black nav bar pinned to the top of every page. Background `{colors.surface-black}`, height 44px, text `{colors.on-dark}` in `{typography.nav-link}` (12px / 400). Links are quiet, spaced 20px apart, running edge-to-edge across the top. Right-aligned cluster: Search, Bag icons — always visible. On mobile, collapses to hamburger at 834px and the Apple logo centers.

**`sub-nav-frosted`** — Surface-specific nav that sticks below the global nav. Background `{colors.canvas-parchment}` at 80% opacity with `backdrop-filter: saturate(180%) blur(20px)`, creating a frosted-glass effect. Height 52px. Content on left: product category name ("iPhone", "Store", "Accessories") in `{typography.tagline}` (21px / 600). Content right: inline nav links in `{typography.button-utility}` (14px), ending in a persistent `{component.button-primary}` ("Buy") or a utility link.

### Buttons

**`button-primary`** — The signature Apple action. Background `{colors.primary}` (Action Blue #0066cc), text `{colors.on-primary}` in `{typography.body}` (SF Pro Text 17px / 400), rounded `{rounded.pill}` (full pill — capsule-shaped), padding 11px × 22px. The full-pill radius IS the brand action signal.
- Active state: `{component.button-primary-active}` — `transform: scale(0.95)` for 120ms ease-out (the system-wide micro-interaction).
- Focus state: `{component.button-primary-focus}` — 2px solid `{colors.primary-focus}` outline, 2px offset.

**`button-secondary-pill`** — Used as the second CTA when two blue pills appear together ("Learn more" / "Buy"). Background transparent, text `{colors.primary}`, 1px solid `{colors.primary}` border, rounded `{rounded.pill}`, padding 11px × 22px. Reads as a "ghost pill."

**`button-dark-utility`** — Global nav actions (Sign In, Bag, language selector). Background `{colors.ink}` (#1d1d1f), text `{colors.on-dark}` in `{typography.button-utility}` (14px / 400 / -0.224px tracking), rounded `{rounded.sm}` (8px), padding 8px × 15px. Active state shrinks via `transform: scale(0.95)`.

**`button-pearl-capsule`** — Product-card secondary button. Background `{colors.surface-pearl}` (#fafafc), text `{colors.ink-muted-80}` in `{typography.caption}` (14px), 3px solid `{colors.divider-soft}` border (functions as a soft ring rather than a visible line), rounded `{rounded.md}` (11px), padding 8px × 14px.

**`button-store-hero`** — A larger primary CTA used on store hero surfaces. Same Action Blue + Paper White as `{component.button-primary}`, but with `{typography.button-large}` (18px / 300 — note the rare weight 300) and slightly more padding (14px × 28px). Used sparingly on the store landing.

**`button-icon-circular`** — Floats over photography. 44 × 44px, background `{colors.surface-chip-translucent}` at 64% alpha, icon in `{colors.ink}`, rounded `{rounded.full}`. Used for carousel controls, close buttons, and in-image controls (product image thumbnails on the iPhone buy page).

**`text-link`** — Inline body links in `{colors.primary}` (Action Blue). In running text (paragraphs, messages, answers) links are underlined with a 2px offset; links that are UI (nav items, button-like links) carry no underline and gain one on hover.

**`text-link-on-dark`** — Inline body links on dark tiles in `{colors.primary-on-dark}` (Sky Link Blue #2997ff) — Action Blue would disappear against `{colors.surface-tile-1}`.

### Cards & Containers

**`product-tile-light`** — Full-bleed light tile. Background `{colors.canvas}` (white), text `{colors.ink}`, rounded `{rounded.none}` (0 — tiles touch edges), vertical padding `{spacing.section}` (80px). Centered stack: product name in `{typography.display-lg}` (40px / 600) → one-line tagline in `{typography.lead}` (28px / 400) → two `{component.button-primary}` CTAs ("Learn more" / "Buy") → product render resting on the surface with the system shadow.

**`product-tile-parchment`** — Same as `{component.product-tile-light}` but on `{colors.canvas-parchment}` (#f5f5f7). Used to break two consecutive white tiles.

**`product-tile-dark`** — Full-bleed dark tile. Background `{colors.surface-tile-1}` (#272729), text `{colors.on-dark}`, rounded `{rounded.none}`, vertical padding `{spacing.section}` (80px). Same content stack as the light tile but with `{component.text-link-on-dark}` for inline copy and `{component.button-primary}` (Action Blue still works on the dark surface). Used on the homepage product grid as the alternating dark band.

**`product-tile-dark-2`** — Variant on `{colors.surface-tile-2}` (#2a2a2c). Used where a dark tile sits directly above or below `{component.product-tile-dark}` to create the faintest separation through micro-step lightness change.

**`product-tile-dark-3`** — Variant on `{colors.surface-tile-3}` (#252527). Used at the bottom of the stack and in embedded video/player frames.

**`store-utility-card`** — Used in store grid and accessories grid. Background `{colors.canvas}` (white), 1px solid `{colors.hairline}` border, rounded `{rounded.lg}` (18px), padding `{spacing.lg}` (24px). Top: product image (1:1 crop with `{rounded.sm}` (8px) inner image radius). Below: product name in `{typography.body-strong}` (17px / 600), price in `{typography.body}` (17px / 400), and a `{component.text-link}` ("Buy" or "Learn more"). No shadow by default; product render itself carries the system product-shadow.

**`configurator-option-chip`** — Pill-shaped tappable cell used in the iPhone 17 Pro buy page. Background `{colors.canvas}`, text `{colors.ink}` in `{typography.caption}`, rounded `{rounded.pill}`, padding 12px × 16px. Contains a small product thumbnail + label + price delta. Arranged in a grid of 4–5 options per row.

**`configurator-option-chip-selected`** — Selected state. Border upgrades to 2px solid `{colors.primary-focus}`. Same shape, same content.

**`environment-quote-card`** — A photographic-canvas hero specific to the environment page. Dark photographic backdrop (mountain vista at dawn) with `{colors.surface-tile-1}` as the fallback color, centered white-text headline in `{typography.display-lg}` (40px), small green "Apple 2030" pictographic logo above the headline, single `{component.button-primary}` below. Padding `{spacing.section}` (80px).

**`floating-sticky-bar`** — Floats at the bottom of the viewport on the iPhone 17 Pro buy page during scroll. Background `{colors.canvas-parchment}` at 80% opacity with `backdrop-filter: saturate(180%) blur(20px)`, height 64px, padding 12px × 32px. Left: running price total in `{typography.body}`. Right: `{component.button-primary}` ("Add to Bag").

### Inputs & Forms

**`search-input`** — The accessories search input. Background `{colors.canvas}`, text `{colors.ink}` in `{typography.body}` (17px), 1px solid `{colors.hairline}` border, rounded `{rounded.pill}` (full pill — search is also pill-shaped, matching the CTA grammar), padding 12px × 20px, height 44px. Leading icon: search glyph at 14px, muted tint.

### Footer

**`footer`** — Background `{colors.canvas-parchment}` (#f5f5f7), text `{colors.ink-muted-80}`. Link columns in `{typography.dense-link}` (17px / 400 / 2.41 line-height — the relaxed leading is what makes the dense columns scannable). Column headings in `{typography.caption-strong}` (14px / 600). Legal row at the very bottom in `{typography.fine-print}` (12px / 400) with `{colors.ink-muted-48}` text. Vertical padding 64px.

### 앱 부품

앱 부품은 모두 `app-`로 시작한다. 마우스를 올렸을 때(hover)도 적는다. 누르면 0.95배로 줄었다가 돌아오고(120ms ease-out), 키보드로 가면 2px `{colors.primary-focus}` 고리가 보인다.

#### 채널 패널

- **`app-side-panel`** 안쪽 위에 워크스페이스 이름(`{typography.app-heading}`)과 레포 이름(`{typography.app-micro}`, 보조 글씨)이 있다.
- **`app-section-title`** "채널"처럼 12px/600 보조 글씨다. 줄과 같은 왼쪽 선(10px 들여)에 맞춘다.
- **`app-nav-item`** 채널 줄. 높이 30px, 줄 사이 2px(32px 간격), 안쪽 0 10px, `{rounded.sm}`. 18px `#` 아이콘과 15px 이름이 8px 떨어져 있다.
  - 올렸을 때 `{component.app-nav-item-hover}`, 고른 채널은 `{component.app-nav-item-selected}`(바탕 6%, 이름 600, 아이콘만 강조색).
  - "채널 만들기"는 같은 줄 모양에 `+` 아이콘과 보조 글씨다.
- 좁은 화면(833px 이하)에서는 줄 높이를 44px로 올린다.

#### 프로필 패널과 상태 메뉴

- **`app-profile-panel`** 채널 패널 맨 아래. 바탕 `{colors.selected}`, `{rounded.md}`, 안쪽 4px. 패널 전체가 버튼 하나이고, 누르면 상태 메뉴가 열린다. 오른쪽에 다른 버튼을 두지 않는다(설정은 상태 메뉴 안에 있다).
  - 아바타 36px(접속 점 12px), 이름 15px/600, 그 아래 상태 메시지 12px 보조 글씨(이모지를 쓸 수 있다, 길면 말줄임).
- **상태 메뉴**는 `{component.app-popover}`이고 프로필 패널 바로 위에 열린다. 위에서부터:
  1. 아바타 40px, 이름, GitHub 아이디
  2. 상태 메시지 칸(높이 36px, `{rounded.md}`, 1px 선). 왼쪽에 28px 이모지 버튼, 오른쪽에 24px 지우기 버튼. 상태 메시지에는 따로 만료 시간을 두지 않는다.
  3. 구분선, "온라인"
  4. 구분선, "자리 비움", "방해 금지"(설명: 알림을 받지 않아요), "오프라인으로 보이기"(설명: 다른 사람에게 오프라인으로 보여요). 셋은 오른쪽 꺾쇠로 시간 메뉴를 연다: 15분 동안, 1시간 동안, 8시간 동안, 24시간 동안, 3일 동안, 직접 바꿀 때까지. 시간 메뉴는 오른쪽 옆에 같은 떠 있는 층으로 열린다.
  5. 구분선, "설정", "로그아웃"(`{colors.error}`)
- **`app-menu-item`** 높이 32px(설명이 붙으면 40px), `{rounded.sm}`, 14px. 올렸을 때 `{colors.hover}`.

#### 접속 점

- 사람 아바타 오른쪽 아래에 붙는다. 아바타 36~40px에는 12~13px, 둘레에 바탕색 2.5px 고리를 둔다.
- 모양으로도 가른다: 온라인은 초록 원, 자리 비움은 주황 초승달, 방해 금지는 빨간 원에 흰 가로줄, 오프라인은 회색 빈 고리.
- 에이전트 표시의 점(9px)은 러너가 붙어 있는지다. 붙어 있으면 초록 원, 아니면 빈 고리. 사람의 접속 상태와 따로 간다.

#### 채널 머리 띠

- **`app-channel-header`** 높이 52px. 왼쪽에 `# 채널 이름`(`{typography.app-title}` 20px/600)과 "멤버 N명"(보조 글씨).
- **`app-header-button`** 오른쪽에 두 개: 내 에이전트, 멤버 목록. 평소에는 18px 아이콘만 보인다. 눌러서 오른쪽 칸이 열린 버튼만 `{component.app-header-button-pressed}`(바탕 6%, 아이콘 강조색)가 되고 이름(13px)이 붙는다. 아이콘만 보일 때도 이름은 `aria-label`로 읽힌다.

#### 멤버 목록

- 그룹 제목은 "온라인 — 3", "오프라인 — 1"이다(`{component.app-section-title}`). 자리 비움과 방해 금지는 온라인에 넣는다.
- **`app-member-row`** 접힌 것이 기본이다. 행 전체가 버튼(`aria-expanded`)이고, 안쪽 6px 8px, `{rounded.md}`, 올렸을 때 `{colors.hover}`.
  - 사람 아바타 40px(동그라미, 바탕 `{colors.chip}`, 이니셜 15px)와 접속 점 13px.
  - 첫 줄: 이름 15px/600. 내 행이면 이름 뒤에 "나"(12px 보조).
  - 둘째 줄(`{component.app-member-status}` 13px): 상태 메시지, 그 옆에 "· 작업 N개"(보조 글씨). 메시지가 길면 메시지만 잘리고 작업 수는 늘 보인다. 상태 메시지가 없으면 그 자리에 접속 상태(자리 비움, 방해 금지, 오프라인)를 보조 글씨로 쓰고, 둘 다 없으면 "작업 N개"만 쓴다.
  - 작업이 있으면 오른쪽에 14px 꺾쇠. 접혀 있으면 오른쪽을, 펼쳐지면 아래를 가리킨다.
- **펼친 행**(`{component.app-member-row-open}`)은 바탕이 6%로 깔리고, 이름 시작 위치(왼쪽 60px)에 맞춰 작업마다 한 덩어리가 붙는다:
  - 에이전트 표시 20px
  - 작업 줄(`{component.app-work-line}` 13px): 그 작업의 상태 한 줄. 고르는 순서는 ADR-0010을 따른다.
  - 그 아래 브랜치와 쓴 시각(12px 보조), 오프라인인 사람이면 "N시간 전 기준" 배지
- 오프라인인 사람은 아바타를 50% 흐리게, 이름을 보조 글씨색으로 쓴다.

#### 에이전트 표시

- **`app-agent-mark`** 20px 둥근 네모(`{rounded.xs}`), 바탕 `{colors.surface-tile-1}`, 흰 11px/600 글씨로 실행기 약자를 쓴다: Claude Code는 `CC`, Codex는 `CX`. 회사 로고는 쓰지 않는다.
- 에이전트 이름은 "지은의 Claude Code"처럼 사람과 실행기를 함께 쓴다(ADR-0015).

#### 메시지

- **`app-message`** 목록형. 아바타 36px, 이름 15px/600과 시각 12px 보조가 한 줄, 그 아래 본문 15px/1.47. 안쪽 6px 20px, 글줄 최대 720px.
- 같은 사람이 5분 안에 이어 쓴 메시지는 머리 없이 묶는다. 묶인 줄의 시각은 올렸을 때 왼쪽에 보인다.
- 날짜가 바뀌면 가운데 "오늘"처럼 12px 보조 글씨와 양옆 `{colors.divider}` 선을 둔다.
- 메시지에 든 HTML과 스크립트는 실행하지 않고 글자로 보인다.

#### 문답

- **`app-qa-line`** 채널에 올라온 문답의 접힌 한 줄. 파치먼트, `{rounded.pill}`, 최소 높이 36px, 메시지 본문 위치에 맞춰 들인다. 에이전트 표시, "지은의 Claude Code"(600), 질문(보조 글씨, 말줄임), 오른쪽에 "펼치기".
- **`app-qa-card`** 펼친 모습. 흰 바탕, 1px `{colors.hairline}`, `{rounded.lg}`, 안쪽 16px.
  - 머리: 에이전트 표시, 이름, "지은이 올림 · 시각", 오른쪽에 공개 배지
  - 질문(15px/600), 답(`{typography.app-answer}` 마크다운)
  - 아래 구분선 위에 "본 코드", 브랜치·커밋(`{component.app-source-ref}`), 작업 중 변경이 있으면 "작업 중 변경 포함" 배지, 오른쪽에 "접기"
- DM 안의 문답은 같은 카드에 비공개 배지를 달고, 아래에 "채널에 올리기"(테두리 버튼)를 둔다.

#### 입력

- **`app-text-input`** 높이 36px, `{rounded.md}`, 1px `{colors.hairline}`, 15px. 위에 라벨(13px/600), 아래에 도움말(12px 보조).
  - 입력 중: 테두리 `{colors.primary}`와 바깥 3px `{colors.focus-ring}`
  - 오류: 테두리 `{colors.error}`, 도움말 글씨도 `{colors.error}`, `aria-invalid`
- **`app-composer`** 메시지 입력 칸. 흰 바탕, 1px 선, `{rounded.lg}`, 안쪽 6px 6px 6px 16px. 줄이 늘어나면 200px까지 커지고 그 뒤로는 칸 안에서 스크롤한다. 오른쪽에 32px 둥근 보내기 버튼(`{component.app-send-button}`). Enter는 보내기, Shift+Enter는 줄바꿈.
  - 러너가 꺼져 있으면 `{component.app-composer-disabled}`: 파치먼트 바탕에 "Claude Code 러너가 꺼져 있어 지금은 물을 수 없어요", 보내기 버튼은 막힌다.

#### 버튼

- **`app-button`** 높이 32px, `{rounded.pill}`, 14px. 기본은 파란 바탕이다.
- **`app-button-outline`** 테두리만, **`app-button-quiet`** 바탕 없음(취소 등), **`app-button-danger`** 오류색 글씨(나가기 등), **`app-button-disabled`** 칩 바탕에 보조 글씨.
- 한 화면에 파란 바탕 버튼은 하나만 둔다.

#### 배지

- **`app-badge`** 높이 20px, `{rounded.pill}`, 12px. 쓰임은 넷이다.
  - 비공개: 칩 바탕
  - 공개: `{component.app-badge-outline}`
  - 작업 중 변경 포함: `{component.app-badge-warning}`
  - N시간 전 기준: 테두리 배지 앞에 11px 시계 아이콘

#### 알림 띠

- 채널 머리 띠 바로 아래, 대화 칸 폭에 맞춰 둔다. 높이 36px, `{rounded.md}`, 13px. 오른쪽 동작은 밑줄 600 글씨다.
  - **`app-banner-info`** 정보: "서버에 다시 붙는 중…"
  - **`app-banner-warning`** 경고: "Codex 러너가 꺼져 있어요 · 설정 보기"
  - **`app-banner-error`** 오류(`role="alert"`): "메시지를 보내지 못했어요 · 다시 시도"

#### 떠 있는 층

- **`app-popover`** 메뉴. 흰 바탕, 1px 선, 떠 있는 층의 그림자, `{rounded.md}`, 안쪽 6px.
- **`app-dialog`** 대화 상자. 폭 400px, `{rounded.lg}`, 안쪽 24px, 화면 가운데에 둔다. 뒤 덮개는 `{colors.overlay}`. 위에 제목(17px/600), 아래 오른쪽에 버튼("취소"는 조용한 버튼, 주 동작은 기본 버튼). Esc와 덮개 누르기로 닫힌다.
- **`app-tooltip`** 툴팁. `{colors.ink}` 바탕, 흰 12px, `{rounded.xs}`, 안쪽 4px 8px. 0.5초 머물면 보인다. 아이콘만 있는 버튼에 쓴다.

#### 상태

- **불러오는 중**: `{component.app-skeleton}` 회색 막대. 아바타 자리 원과 두 줄(30%, 90% 폭)을 메시지 두세 개만큼 둔다(`aria-busy`).
- **답하는 중**: 에이전트 표시와 "Claude Code가 답하는 중…"(13px 보조, `role="status"`).
- **끊긴 답**: 경고 띠 "10분이 넘어 답을 끊었어요 · 다시 묻기".
- **빈 상태**: 패널 가운데에 제목(15px/600)과 설명(13px 보조). 예: "# 결제에 아직 메시지가 없어요" / "첫 메시지를 보내거나, 내 에이전트에게 먼저 물어보세요."
- **오류 상태**: 빈 상태와 같은 틀에 "다시 시도"(테두리 버튼)를 더한다.

#### 에이전트 답의 마크다운

- 본문 15px/1.6. 문단, 목록, 인라인 코드(`{component.app-code-inline}`), 링크(강조색, 밑줄)를 그대로 보인다.
- **`app-code-block`** 파치먼트, `{rounded.md}`, 안쪽 12px 14px, `{typography.mono}`. 길면 가로 스크롤한다.
- 표: 13px, 머리 600, 칸 안쪽 6px 10px, 줄마다 `{colors.divider}` 선.
- 답에 든 HTML과 스크립트는 실행하지 않는다.

## Do's and Don'ts

### Do
- Use `{colors.primary}` (Action Blue #0066cc) for every interactive element — links, pill CTAs, focus signals — and nothing else. The single accent is non-negotiable.
- Set headlines in `{typography.hero-display}` or `{typography.display-lg}` with negative letter-spacing (`-0.28 → -0.374px`) to get the signature "Apple tight" cadence.
- Run marketing body copy at `{typography.body}` (17px / 400 / 1.47 / -0.374px) — not 16px. The extra pixel defines the brand's reading pace.
- Alternate `{component.product-tile-light}` (or parchment) and `{component.product-tile-dark}` for full-bleed section rhythm. The color change IS the divider.
- Reserve `{rounded.pill}` for the primary blue CTA and any other element that should read as an "action" (configurator chips, search input, sticky bar CTA).
- Apply the single product-shadow (`rgba(0, 0, 0, 0.22) 3px 5px 30px`) only to product renders resting on a surface.
- Use `transform: scale(0.95)` for 120ms as the active/press state on every button — it's the system-wide micro-interaction.
- Keep the global nav `{colors.surface-black}` (true black) — it's the only place pure black appears on most pages.
- 앱: 읽어야 하는 글씨는 11px 이상으로 쓴다.
- 앱: 보조 글씨는 `{colors.text-secondary}`로 쓴다.
- 앱: 사람은 동그라미 아바타와 접속 점, 에이전트는 둥근 네모와 실행기 약자로 가른다.
- 앱: 작업마다 붙는 "상태 한 줄"(에이전트가 씀)과 사람이 정하는 "상태 메시지"를 섞지 않는다. 멤버 행을 접으면 상태 메시지가, 펼치면 상태 한 줄이 보인다.

### Don't
- Don't introduce a second accent color; every "click me" signal is `{colors.primary}` (Action Blue).
- Don't add shadows to cards, buttons, or text — shadow is reserved for product imagery and, in the app, floating layers (menus, dialogs).
- Don't use gradients as decorative backgrounds; atmosphere comes from photography.
- Don't use weight 500 or 700. The ladder is 300 / 400 / 600. Body is always 400; strong inline is 600; display is 600.
- Don't round full-bleed tiles — tiles are rectangular and edge-to-edge; the color change is the divider.
- Don't tighten line-height below 1.47 for body copy — the editorial leading is part of the brand.
- Don't mix radii outside the scale: `{rounded.xs}`, `{rounded.sm}`, `{rounded.md}`, `{rounded.lg}`, `{rounded.pill}` — and nothing in between.
- Don't use `{colors.primary-on-dark}` (Sky Link Blue) on light surfaces — it's the dark-tile-only variant. Action Blue is for light surfaces.
- 앱: 한글에 음수 자간을 주지 않는다.
- 앱: 회사 로고나 이모지를 아이콘으로 쓰지 않는다.
- 앱: 오른쪽 칸에 멤버 목록과 DM을 함께 열지 않는다.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Small phone | ≤ 419px | Single-column tiles; sub-nav collapses to category name + primary CTA only; hero typography drops to 28px |
| Phone | 420–640px | Single-column stack; product renders scale to 80% of tile width; hero h1 drops to 34px |
| Large phone | 641–735px | Tiles transition to tighter padding (48px vertical vs 80px); fine-print wraps |
| Tablet portrait | 736–833px | Global nav collapses to hamburger; sub-nav hides category chips, keeps primary CTA |
| Tablet landscape | 834–1023px | Global nav returns fully expanded; 3-column utility grids become 2-column |
| Small desktop | 1024–1068px | Product tiles use 2/3 width with margin gutters; hero h1 stays at 40px |
| Desktop | 1069–1440px | Full layout; 4–5 column store grids; 1440px content max |
| Wide desktop | ≥ 1441px | Content locks at 1440px, margins absorb extra width |

The structural breakpoints that matter for agents: 1440px (content lock), 1068px (small-desktop), 833px (tablet landscape switch), 734px (tablet portrait), 640px (phone), 480px (small phone).

### Touch Targets
- Minimum 44 × 44px. `{component.button-primary}` lands at ~44 × 100px (with the full-pill radius making the visible hit area more generous than the label suggests).
- `{component.button-icon-circular}` is exactly 44 × 44px.
- Global nav utility links are smaller (~32 × 80px) — they deliberately sit at a tighter target because they're precision desktop actions, and the mobile hamburger replaces them at ≤ 833px.
- 앱의 데스크톱 줄(채널 줄 30px, 머리 띠 버튼 32px)도 같은 이유로 작고, 833px 이하에서는 44px로 키운다.

### Collapsing Strategy
- **Global nav**: full horizontal link row on desktop → collapses to Apple logo + hamburger + bag icon at 834px and below.
- **Sub-nav**: category name + inline links + primary CTA → category name + primary CTA only at mobile; inline links move into a hamburger tray.
- **Product tiles**: stack from 2-column to 1-column at 834px; vertical padding tightens from 80px → 48px at small-phone.
- **Utility grids** (store, accessories): 5-col → 4-col (1440px) → 3-col (1068px) → 2-col (834px) → 1-col (640px).
- **Hero typography**: `{typography.hero-display}` (56px) → `{typography.display-lg}` (40px) at 1068px → 34px at 640px → 28px at 419px.

### 앱의 좁은 화면

| 폭 | 앱 틀 |
| --- | --- |
| 1069px 이상 | 세 칸(채널 패널, 대화, 오른쪽 칸) |
| 834–1068px | 채널 패널과 대화 두 칸. 오른쪽 칸은 대화 위에 겹쳐 열린다(폭 320px, 떠 있는 층) |
| 833px 이하 | 대화만. 머리 띠 왼쪽 메뉴 버튼이 채널 패널(프로필 포함)을 왼쪽 서랍으로 열고, 오른쪽 두 버튼이 내 에이전트와 멤버 목록을 아래에서 올라오는 전체 높이 시트로 연다. 버튼과 줄은 44px |

### Image Behavior
- All product imagery uses responsive `srcset` with breakpoint-matched crops.
- Hero photography may switch art direction at mobile (e.g., the environment page's vista crops to a taller aspect ratio on mobile, framing the subject differently).
- Product renders maintain their 1:1 or 4:3 aspect ratios across breakpoints; only scale changes.
- Lazy-loading is default; the above-fold hero loads eagerly.

## Iteration Guide

1. Focus on ONE component at a time. Reference its YAML key directly (`{component.product-tile-dark}`, `{component.app-member-row}`).
2. Variants of an existing component (`-active`, `-focus`, `-hover`, `-open`, `-2`, `-3`) live as separate entries in `components:`.
3. Use `{token.refs}` everywhere — never inline hex. Components point at primitive tokens (`{typography.app-body.fontSize}`), not whole groups, so every reader resolves them.
4. Marketing pages document Default and Active/Pressed only. App components also document hover, because the app is used with a mouse all day.
5. Display headlines stay SF Pro Display 600 with negative letter-spacing. Marketing body stays SF Pro Text 400 at 17px. App text stays IBM Plex Sans KR at 0 letter-spacing.
6. The single drop-shadow (`rgba(0, 0, 0, 0.22) 3px 5px 30px`) is reserved for product photography; floating layers in the app use their own lighter shadow.
7. When in doubt about emphasis: alternate surface (light → dark tile, white → parchment) before adding chrome.

## Known Gaps

- Dark-mode counterparts for store and accessories utility cards were not surfaced on the analyzed pages. The app's dark values are set as `dark-*` tokens, but stage 1 ships light mode only.
- The homepage's embedded video/player frame uses `{colors.surface-black}`; interior player controls are not documented (they're a platform widget, not a web-design token).
- Some component imagery is dynamic (rotating product hero) and its specific copy varies per surface — component specs name the structure, not the rotating content.
- Atmospheric photography (environment page mountain vista) is a content asset, not a design token; the documented `{component.environment-quote-card}` describes the structural surface only.
- 앱: 포럼 채널, 포스트, 결정함, 부딪힘 알림은 1단계 화면이 아니라서 아직 부품이 없다. 2단계 이슈가 이 문서에 더한다.
- 앱: 실행기가 늘어나면 `app-agent-mark`의 약자를 여기에 더한다(지금은 `CC`, `CX`).
- 앱: 컴포넌트에 쓴 `borderColor`, `iconColor`, `shadow`, `backdropFilter`, `maxWidth` 같은 속성과 글자 값 하나씩 가리키기(`fontSize` 등)는 design.md 규격 검사기에서 "모르는 속성" 경고로 나온다. 오류가 아니라 경고이고, gstack 검사기가 모든 참조를 풀 수 있게 하려고 이렇게 쓴다.
