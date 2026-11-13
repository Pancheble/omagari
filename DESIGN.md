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
  app-side-panel-peek:
    backgroundColor: "{colors.canvas-parchment}"
    borderColor: "{colors.hairline}"
    shadow: 0 8px 24px #0000001f
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
  app-dm-question:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body.fontFamily}"
    fontSize: "{typography.app-body.fontSize}"
    fontWeight: "{typography.app-body.fontWeight}"
    lineHeight: "{typography.app-body.lineHeight}"
    rounded: "{rounded.lg}"
    padding: 8px 12px
    maxWidth: 80%
  app-dm-answer:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-answer.fontFamily}"
    fontSize: "{typography.app-answer.fontSize}"
    fontWeight: "{typography.app-answer.fontWeight}"
    lineHeight: "{typography.app-answer.lineHeight}"
  app-post-action:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    fontWeight: "{typography.app-caption.fontWeight}"
    rounded: "{rounded.sm}"
    height: 28px
    padding: 0 8px
  app-message-highlight:
    backgroundColor: "{colors.selected}"
    rounded: "{rounded.md}"
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
  app-badge-ai:
    backgroundColor: transparent
    borderColor: "{colors.hairline}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    height: 20px
    padding: 0 6px
  app-issue-number:
    textColor: "{colors.text-secondary}"
    typography: "{typography.app-body}"
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
    lineHeight: "{typography.app-caption.lineHeight}"
    rounded: "{rounded.sm}"
    height: 32px
    padding: 8px
  app-call-token:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    fontWeight: 600
    rounded: "{rounded.pill}"
    height: 28px
  app-qa-attachment:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    fontWeight: "{typography.app-caption.fontWeight}"
    rounded: "{rounded.pill}"
    height: 36px
    padding: 4px 4px 4px 8px
  app-composer-chip:
    backgroundColor: transparent
    textColor: "{colors.text-secondary}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    fontWeight: "{typography.app-caption.fontWeight}"
    rounded: "{rounded.sm}"
    height: 28px
    padding: 0 8px
  app-forum-search:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body.fontFamily}"
    fontSize: "{typography.app-body.fontSize}"
    rounded: "{rounded.md}"
    height: 40px
    padding: 0 12px
  app-tag-chip:
    backgroundColor: transparent
    borderColor: "{colors.hairline}"
    textColor: "{colors.text-secondary}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    rounded: "{rounded.pill}"
    height: 28px
    padding: 0 10px
  app-tag-chip-on:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    fontWeight: 600
    rounded: "{rounded.pill}"
  app-forum-post:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body-strong.fontFamily}"
    fontSize: "{typography.app-body-strong.fontSize}"
    fontWeight: "{typography.app-body-strong.fontWeight}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  app-forum-card:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  app-post-panel:
    backgroundColor: "{colors.canvas-parchment}"
    borderColor: "{colors.selected}"
    rounded: "{rounded.lg}"
    padding: 0 8px 8px
    width: 480px
  app-alert-card:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: 14px
    rounded: "{rounded.md}"
    padding: 10px 14px
  app-omagari-mark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    size: 36px
  app-draft-band:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    rounded: "{rounded.md}"
    padding: 10px 12px
  app-decision-strip:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 6px 8px 6px 14px
  app-decision-strip-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    rounded: "{rounded.md}"
  app-decision-strip-error:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.error}"
    rounded: "{rounded.md}"
  app-verdict-strip:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 6px 8px 6px 14px
  app-verdict-strip-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    rounded: "{rounded.md}"
  app-verdict-output:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    fontSize: 12px
    rounded: "{rounded.sm}"
    padding: 10px 12px
  app-settings-window:
    backgroundColor: "{colors.canvas-parchment}"
    borderColor: "{colors.hairline}"
    shadow: 0 8px 24px #0000001f
    overlayColor: "{colors.overlay}"
    rounded: "{rounded.lg}"
    width: 820px
    height: 580px
  app-settings-item:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body.fontFamily}"
    fontSize: "{typography.app-body.fontSize}"
    rounded: "{rounded.sm}"
    height: 36px
    padding: 0 10px
  app-settings-group:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.selected}"
    rounded: "{rounded.md}"
  app-settings-row:
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body.fontFamily}"
    fontSize: "{typography.app-body.fontSize}"
    height: 52px
    padding: 10px 16px
  app-switch:
    backgroundColor: "{colors.offline}"
    rounded: "{rounded.pill}"
    width: 40px
    height: 24px
  app-switch-on:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.pill}"
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
- **칩과 뼈대**: `{colors.chip}` #e8e8ed는 아바타 바탕, 막힌 버튼, 불러오는 중의 회색 막대에 쓴다.
- **덮개와 고리**: 대화 상자 뒤 덮개 `{colors.overlay}`(검정 32%). 입력 칸에는 포커스 고리를 두지 않는다(아래 "입력").
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
- **오른쪽 칸은 하나만**: 멤버 목록, 내 에이전트(DM), 옆 칸에 연 포스트(480px, "부딪힘 포럼") 가운데 하나만 열린다. 채널 머리 띠의 두 버튼으로 열고, 같은 버튼을 다시 누르면 닫힌다. 닫히면 대화 칸이 넓어진다.
- **채널 패널은 접힌다**(834px 이상): 접으면 패널이 자리째 빠지고 대화 칸이 창 왼쪽 8px까지 넓어진다. 접힌 동안에는 창 왼쪽 가장자리에서 잠깐 꺼내 볼 수 있다. 처음에는 펼쳐 둔다. 자세한 것은 "채널 패널 접기"에 있다.
- **대화 칸**: 위에서부터 머리 띠(52px, 아래에 `{colors.divider}` 선), 메시지 목록(아래로 쌓임), 입력 칸이다. 메시지 글줄은 720px을 넘지 않는다.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Full-bleed tiles, global nav, footer, body sections |
| Soft hairline | 1px `{colors.hairline}` border | Utility cards, inputs, chips, the Q&A card |
| Backdrop blur | `backdrop-filter: saturate(180%) blur(20px)` on Parchment 80% | Sub-nav and the iPhone buy floating sticky bar |
| Floating layer (앱) | 1px `{colors.hairline}` + `0 8px 24px rgba(0, 0, 0, 0.12)` | 메뉴, 상태 메뉴의 시간 고르기, 대화 상자, 꺼내 본 채널 패널 |
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
- **아이콘**: Lucide(ISC 라이선스)를 쓴다. 선 굵기 1.5px, 16·18·20px 세 크기만 쓴다. 회사 로고와 이모지는 아이콘으로 쓰지 않는다(이모지는 사람이 쓴 상태 메시지와 이모지 팔레트 안에서만 쓴다).

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
- **카테고리**: 채널은 종류별 카테고리로 묶는다. "채팅 채널"과 그 아래 "포럼 채널" 둘이다(2026-11-13 시안 14-A). 2단계의 포럼 채널은 부딪힘 하나다(아래 "부딪힘 포럼"). 사람이 직접 만드는 카테고리는 두지 않는다.
  - 머리는 높이 28px, `{rounded.sm}`. 왼쪽에 이름(`{component.app-section-title}`, 12px/600 보조 글씨), 그 뒤에 12px 꺾쇠, 오른쪽 끝에 28px `+` 버튼("채팅 채널 만들기")이 있다.
  - 꺾쇠와 `+`는 머리에 마우스를 올렸을 때(바탕 `{colors.hover}`)나 키보드로 머리 안에 갔을 때(`:focus-within`)만 보인다. 손가락으로 쓰는 좁은 화면(833px 이하)에서는 늘 보인다. 보이지 않을 때도 자리는 그대로 둬서 줄이 흔들리지 않는다.
  - 이름을 누르면 접히고 펼쳐진다(`aria-expanded`). 꺾쇠는 펼쳐지면 아래, 접히면 오른쪽을 가리키고 150ms로 돈다. 접어도 지금 고른 채널은 남는다. 접힌 상태는 기기마다 기억한다.
  - `+`를 누르면 "채널 만들기" 대화 상자(`{component.app-dialog}`)가 열린다. 목록 아래에 "채널 만들기" 줄은 따로 두지 않는다.
- **`app-nav-item`** 채널 줄. 높이 30px, 줄 사이 2px(32px 간격), 안쪽 0 10px, `{rounded.sm}`. 18px `#` 아이콘과 15px 이름이 8px 떨어져 있다.
  - 올렸을 때 `{component.app-nav-item-hover}`, 고른 채널은 `{component.app-nav-item-selected}`(바탕 6%, 이름 600, 아이콘만 강조색).
  - 채널 줄에는 초대나 설정 버튼을 두지 않는다. 1단계에는 채널마다의 멤버나 설정이 없다. 생기면 줄에 올렸을 때 보이는 버튼으로 더한다.
- 좁은 화면(833px 이하)에서는 줄과 카테고리 머리 높이를 44px로 올린다.

#### 채널 패널 접기

넓은 화면(834px 이상)에서 채널 패널을 접어 대화 칸을 넓힌다. 접으면 다 숨기고, 필요할 때 창 왼쪽 가장자리에서 잠깐 꺼내 본다(Notion의 사이드바처럼).

- **접는 버튼**: 워크스페이스 이름 줄 오른쪽 끝의 28px 버튼이다. `{rounded.sm}`, 18px Lucide `panel-left-close`, 보조 글씨 색이고 늘 보인다. 올렸을 때 `{colors.hover}`, 툴팁은 "채널 패널 닫기 ⌘\". 833px 이하의 서랍에서는 숨긴다.
- **접은 모습**: 패널이 그 안의 프로필 패널까지 다 빠지고, 대화 칸이 창 왼쪽 8px까지 넓어진다. 아이콘 줄은 남기지 않는다.
  - 채널 머리 띠 왼쪽 끝(좁은 화면의 메뉴 버튼 자리)에 32px 펴는 버튼(`{component.app-header-button}`, Lucide `panel-left-open`)이 생긴다. 툴팁은 "채널 패널 열기 ⌘\"이고, 누르면 펼친다.
  - 펴는 버튼이 있는 동안 머리 띠 왼쪽 안쪽 여백은 4px이다.
- **꺼내 보기**: 접혀 있을 때 펴는 버튼이나 창 왼쪽 가장자리(창 안쪽 여백 8px)에 마우스를 0.3초 두면, 패널이 대화 위에 떠서 보인다(`{component.app-side-panel-peek}`).
  - 자리는 펼친 패널과 같다(위·왼쪽·아래 8px, 폭 240px). 대화 칸은 밀리지 않고, 뒤 덮개도 없다.
  - 왼쪽에서 240ms로 미끄러져 들어온다(서랍과 같은 `cubic-bezier(0.16, 1, 0.3, 1)`).
  - 마우스가 패널 밖으로 나가 0.3초가 지나거나, 채널을 고르거나, Esc를 누르면 닫힌다. 패널에서 연 메뉴나 대화 상자(상태 메뉴, 채널 만들기)가 열려 있는 동안은 닫히지 않는다.
  - 꺼내 본 패널의 오른쪽 위 버튼은 Lucide `panel-left-open`, "채널 패널 펼쳐 두기"가 된다. 누르면 펼친 상태로 돌아간다.
  - 키보드로 펴는 버튼에 가는 것만으로는 꺼내 보지 않는다. 키보드로는 버튼을 눌러 펼친다.
- **단축키**: 맥은 ⌘\, 그 밖은 Ctrl+\로 접고 편다(Notion과 같다). 834px 이상에서만 듣는다.
- **움직임**: 접고 펼 때 패널 칸 폭이 240ms(`cubic-bezier(0.16, 1, 0.3, 1)`)로 줄고 는다. 움직임 줄이기 설정이면 꺼내 보기와 함께 바로 바뀐다.
- **초점**: 접는 버튼으로 접으면 초점이 머리 띠의 펴는 버튼으로, 펴는 버튼으로 펼치면 패널의 접는 버튼으로 간다. 접힌 패널은 초점과 화면 읽기에서 빠진다(`inert`). 두 버튼에 `aria-expanded`와 `aria-controls`를 단다.
- **기억**: 접힌 상태는 카테고리 접기처럼 기기마다 기억한다. 처음에는 펼쳐 둔다.
- 833px 이하에서는 접기가 없다. 머리 띠 왼쪽 메뉴 버튼이 지금처럼 서랍을 연다. 다시 넓어지면 기억한 상태로 돌아간다.

#### 프로필 패널과 상태 메뉴

- **`app-profile-panel`** 채널 패널 맨 아래. 바탕 `{colors.selected}`, `{rounded.md}`, 안쪽 4px. 패널 전체가 버튼 하나이고, 누르면 상태 메뉴가 열린다. 오른쪽에 다른 버튼을 두지 않는다(설정은 상태 메뉴 안에 있다).
  - 아바타 36px(접속 점 12px), 이름 15px/600, 그 아래 상태 메시지 12px 보조 글씨(이모지를 쓸 수 있다, 길면 말줄임).
- **상태 메뉴**는 `{component.app-popover}`이고 프로필 패널 바로 위에 열린다. 위에서부터:
  1. 아바타 40px, 이름, GitHub 아이디
  2. 상태 메시지 칸(높이 36px, `{rounded.md}`, 1px 선). 왼쪽에 28px 이모지 버튼, 오른쪽에 24px 지우기 버튼. 상태 메시지에는 따로 만료 시간을 두지 않는다.
     - **이모지는 한 칸이다.** 글과 따로 두는 값이고, 이모지 버튼이 곧 그 칸이다. 팔레트에서 고르면 그 칸이 바뀐다. 글에 이어 붙지 않는다.
     - 비어 있으면 이모지 버튼에 18px 웃는 얼굴 더하기 아이콘(Lucide `smile-plus`, 보조 글씨 색)을 둔다.
     - 지우기 버튼은 글과 이모지를 함께 지운다. 이모지만 지우려면 팔레트의 "지우기"를 쓴다.
     - 프로필 패널과 멤버 목록에서는 이모지를 글 앞에 한 칸 띄어 쓴다. 이모지만 있으면 이모지만 보인다.
     - 글 칸에 직접 친 이모지는 글로 남는다. 막지 않는다.
  3. 구분선, "온라인"
  4. 구분선, "자리 비움", "방해 금지"(설명: 알림을 받지 않아요), "오프라인으로 보이기"(설명: 다른 사람에게 오프라인으로 보여요). 셋은 오른쪽 꺾쇠로 시간 메뉴를 연다: 15분 동안, 1시간 동안, 8시간 동안, 24시간 동안, 3일 동안, 직접 바꿀 때까지. 시간 메뉴는 오른쪽 옆에 같은 떠 있는 층으로 열린다.
  5. 구분선, "설정", "로그아웃"(`{colors.error}`). "설정"은 설정 창을 연다(아래 "설정 창").
- **`app-menu-item`** 높이 32px(설명이 붙으면 40px), `{rounded.sm}`, 14px. 올렸을 때 `{colors.hover}`.

#### 이모지 팔레트

상태 메시지의 이모지 버튼을 누르면 열린다. Notion의 팔레트처럼 이모지를 모두 담고, 찾고, 분류로 건너뛴다.

- **틀**: `{component.app-popover}`와 같은 떠 있는 층이고 안쪽 여백은 0이다. 상태 메뉴 오른쪽 옆에 열리고, 폭은 474px이다. 위에서부터 찾기 줄, 이모지 목록, 분류 막대가 있다. Esc나 바깥 누르기로 닫힌다. 이모지를 고르면 닫힌다.
- **찾기 줄**(안쪽 10px 10px 8px):
  - 찾기 칸: 높이 32px, `{rounded.sm}`, `{colors.selected}` 바탕, 앞에 14px 돋보기, 14px 글씨. 안내 글은 "이모지 찾기 (예: 웃음, 고양이)". 열리면 초점이 여기 온다.
  - 피부색 버튼: 32px, 지금 고른 피부색의 ✋를 보인다. 누를 때마다 기본과 다섯 피부색을 돈다. 고른 피부색은 그 사람의 브라우저에 기억한다.
  - "지우기": `{component.app-button-quiet}`, 높이 32px. 이모지 칸만 비운다.
- **이모지 목록**: 높이 316px, 칸 안에서 스크롤한다(스크롤바 자리를 늘 비워 둔다).
  - 분류마다 제목(12px/600 보조 글씨)과 12열 격자를 둔다. 한 칸은 34px 정사각형, 사이 2px, `{rounded.sm}`, 이모지 22px. 올렸을 때 `{colors.hover}`, 지금 고른 이모지는 `{colors.selected}`. 칸마다 `aria-label`과 툴팁으로 한국어 이름을 보인다.
  - 맨 위는 "최근 사용"(최근에 고른 12개, 그 사람의 브라우저에 기억)이다. 그 아래는 유니코드 분류 아홉이다: 웃는 얼굴과 감정, 사람과 몸, 동물과 자연, 음식 및 음료, 여행 및 장소, 활동, 사물, 기호, 깃발.
  - 이모지와 한국어 이름, 찾는 말은 Emojibase 한국어 데이터를 쓴다. 손으로 고른 목록을 두지 않는다. 그 기기가 그리지 못하는 이모지는 뺀다.
  - 찾으면 한국어 이름과 찾는 말에서 고르고 "최근 사용"은 숨긴다. 맞는 것이 없으면 가운데에 "찾는 이모지가 없어요"(13px 보조 글씨).
- **분류 막대**: 목록 아래 1px `{colors.divider}` 선 위. "최근 사용"과 분류 아홉의 Lucide 18px 아이콘 버튼 열 개(36×32px, `{rounded.sm}`)를 고르게 놓는다. 누르면 그 분류로 스크롤하고, 지금 보이는 분류의 버튼은 `{colors.selected}` 바탕에 본문 색, 나머지는 보조 글씨 색이다. 버튼마다 툴팁으로 분류 이름을 보인다.
- **키보드**: 찾기 칸에서 아래 화살표로 목록에 들어가고, 화살표로 칸을 옮기고, Enter로 고른다. 목록은 `role="grid"`이다.
- **좁은 화면**(833px 이하): 상태 메뉴 위에 겹쳐 아래에서 올라오는 시트로 열고, 열 수는 폭에 맞춘다. 칸은 44px이다.

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

#### DM 칸

- 오른쪽 칸에 열린다. 채널 머리 띠의 "내 에이전트" 버튼으로 열고 닫는다.
- **머리**(높이 48px)는 고른 에이전트를 보인다: 에이전트 표시 20px, 이름 15px/600, 그 아래 "나만 보여요 · # 채널"(12px 보조). 오른쪽에 닫기 버튼.
- **물을 에이전트는 연결된 에이전트 가운데서만 고른다.** 러너가 꺼진 에이전트는 고를 거리에 나오지 않는다. 쓸 수 없는 버튼을 두지 않는다.
  - 연결된 에이전트가 1개면 고르는 장치가 없다. 머리에 그 에이전트만 보인다.
  - 2개 이상이면 머리 전체가 버튼이 되고, 이름 옆에 14px 꺾쇠가 붙는다(`aria-haspopup="menu"`). 누르면 머리 바로 아래에 `{component.app-popover}` 메뉴가 열린다. 줄마다 에이전트 표시, 이름, 오른쪽에 상태("답하는 중…"은 강조색, "쉬는 중"은 보조 글씨)를 보이고, 고른 줄은 `aria-checked`다. 몇 개로 늘어도 머리 한 줄만 쓴다.
  - 0개면 입력 칸 대신 빈 상태를 보인다: "연결된 에이전트가 없어요" / "이 기기에서 러너를 켜면 여기서 물을 수 있어요."
  - 고른 에이전트의 러너가 끊기면 남은 연결된 에이전트 가운데 첫째로 바뀐다. 남은 것이 없으면 빈 상태가 된다.
- 문답 목록은 고른 에이전트의 것만 보인다. 채널 세션이 채널과 에이전트마다 하나라서(ADR-0015) 에이전트를 바꾸면 그 에이전트와의 문답으로 바뀐다. 채널에 올린 문답과 `@호출`도 같은 채널 세션의 문답이라 공개 배지를 달고 함께 남는다. 머리의 "나만 보여요"는 칸 전체가 아니라 여기서 묻는 문답의 기본 공개 범위를 말한다.
- **문답은 대화 모양으로 놓는다**(2026-11-12 시안 12-A). 300px 칸에서 카드의 테두리와 안쪽 여백을 빼 답을 칸 폭 그대로 읽게 한다. 채널의 문답은 그대로 접힌 줄과 카드다(아래 "문답").
  - **질문**은 오른쪽에 붙은 말풍선(`{component.app-dm-question}`)이다. 흰 바탕, `{rounded.lg}`, 안쪽 8px 12px, 폭은 목록의 80%까지. 물은 시각(12px 보조)은 말풍선 왼쪽 아래에 둔다.
  - **답**(`{component.app-dm-answer}`)은 그 아래 칸 바탕에 바로 놓고 목록 폭을 다 쓴다. 마크다운은 "에이전트 답의 마크다운"을 따르되, 인라인 코드와 코드 블록의 바탕은 칸의 파치먼트와 겹치지 않게 `{colors.canvas}`로 바꾼다.
  - 답 아래 한 줄에 본 브랜치·커밋(`{component.app-source-ref}`), "작업 중 변경 포함" 배지, 답한 모델 배지를 둔다. 좁으면 줄을 바꾼다.
  - 그 아래 동작 줄(높이 28px)에 "채널에 올리기"(`{component.app-post-action}`: 강조색 글자, 앞에 16px Lucide `forward`, 올렸을 때 `{colors.hover}`)를 둔다. 답이 온 비공개 문답에만 있다. 누르면 무엇을 하는지는 "채널에 올리기"에 있다.
  - 공개 문답은 동작 줄에 버튼 대신 16px Lucide `check`와 "# 결제에 올렸어요"(올린 것) 또는 "# 결제에서 @호출로 물었어요"(`@호출`)를 12px 보조 글씨로, 그 뒤에 "보기" 링크(강조색, 올리면 밑줄)를 둔다. "보기"는 채널에서 그 문답 줄로 스크롤하고 `{component.app-message-highlight}`로 잠깐 칠한다.
  - 답하는 중이면 말풍선 아래에 "답하는 중"(아래 "상태")을, 끊긴 답이면 같은 자리에 알림 띠와 "다시 묻기"를 둔다.
  - 문답마다 "비공개" 배지를 달지 않는다. 머리의 "나만 보여요"가 이미 말하고, 공개인 것만 위의 줄로 가른다.
  - 문답 사이는 20px이다. 목록은 아래로 쌓는다. 칸을 열 때와 답이 올 때, 마지막 문답이 목록보다 길면 그 질문의 머리가 목록 위에 오게 스크롤한다(답의 끝이 아니라 질문부터 읽게). 짧으면 맨 아래에 붙인다.
- 입력 칸의 안내 글은 "Claude Code에게 묻기"처럼 고른 에이전트 이름을 쓴다.
- **모델과 effort**는 입력 칸 안에서 고른다. 보낼 때마다 눈에 보이는 자리라서다.
  - DM 칸의 `{component.app-composer}`는 두 줄이 된다. 위는 글, 아래 줄 왼쪽에 모델 칩과 effort 칩(`{component.app-composer-chip}`), 오른쪽 끝에 보내기 버튼이다. 칩은 "Opus ⌄", "effort high ⌄"처럼 고른 값과 12px 꺾쇠를 쓴다. 좁은 화면에서는 칩 높이가 40px이다.
  - 칩을 누르면 `{component.app-popover}` 메뉴가 열린다(`aria-haspopup="menu"`). 줄은 `{component.app-menu-item}`이고 고른 줄은 `aria-checked`와 `{colors.selected}` 바탕이다. 열린 칩도 `{colors.selected}` 바탕이다.
  - **메뉴 자리**: 칩 위가 아니라 입력 칸 위(입력 칸 위 끝에서 4px)에 열어, 쓰던 글을 덮지 않는다. 왼쪽은 누른 칩에 맞추되, 오른쪽이 칸 안쪽 8px을 넘으면 오른쪽을 거기에 맞춘다. 오른쪽 칸 가장자리에 잘리지 않는다. 높이는 입력 칸 위부터 DM 머리 아래까지 남은 만큼이고, 넘치면 메뉴 안에서 스크롤한다.
  - **모델이 많을 때**: 실행기는 지난 판까지 모두 알려 준다(Claude Code는 14개). 이름 끝의 판 번호를 뗀 같은 이름(Opus, Sonnet, Haiku…) 가운데 실행기가 먼저 알린 하나만 "기본" 아래에 두고, 나머지는 맨 아래 "이전 모델 N개" 줄(오른쪽 14px 꺾쇠, `aria-expanded`)로 접는다. 누르면 같은 메뉴 안에서 펼친다. 고른 모델이 이전 모델이면 펼친 채로 연다. 판 번호가 없는 이름은 모두 위에 둔다. (ChatGPT도 지난 모델을 고르기 목록에서 따로 둔다.)
  - 고를 거리는 고른 에이전트의 실행기가 러너를 거쳐 알려 준 것만 보인다. 실행기마다 다르고, 모델에 따라 effort 값도 다르다. 맨 위 줄은 "기본"(오른쪽 보조 글씨 "설정값")이고, 실행기 자기 설정을 그대로 따른다는 뜻이다. 실행기가 effort를 알려 주지 않으면 effort 칩을 두지 않는다.
  - 고른 값은 에이전트마다 기억하고 그 에이전트의 다음 질문부터 쓴다. 에이전트를 바꾸면 칩도 그 에이전트의 값으로 바뀐다. `@호출`은 칩을 따로 두지 않고 그 에이전트에 기억된 값으로 묻는다.
  - 답한 문답 카드에는 어느 모델로 답했는지 배지를 단다(아래 배지).

#### 메시지

- **`app-message`** 목록형. 아바타 36px, 이름 15px/600과 시각 12px 보조가 한 줄, 그 아래 본문 15px/1.47. 안쪽 6px 20px, 글줄 최대 720px.
- 같은 사람이 5분 안에 이어 쓴 메시지는 머리 없이 묶는다. 묶인 줄의 시각은 올렸을 때 왼쪽에 보인다.
- 날짜가 바뀌면 가운데 "오늘"처럼 12px 보조 글씨와 양옆 `{colors.divider}` 선을 둔다.
- 메시지에 든 HTML과 스크립트는 실행하지 않고 글자로 보인다.
- 포스트의 이슈에 GitHub에서 단 댓글이 들어온 글은 머리의 시각 뒤에 `{component.app-badge-outline}` "GitHub"을 단다(ADR-0032). 쓴 사람은 GitHub 로그인이라 멤버가 아닐 수 있다. 글은 마크다운으로 그리지 않고 글자로 보인다.

#### AI가 쓴 글

AI를 불러 한 말은 부른 사람의 이름으로 남기고, AI가 썼다는 것을 늘 함께 보인다(2026-11-13 주인, ADR-0032).

- **앱**: 채널과 포스트의 문답 줄(`{component.app-qa-line}`)은 에이전트 이름 뒤에, 펼친 카드(`{component.app-qa-card}`)는 머리의 공개 배지 앞에 `{component.app-badge-ai}`를 단다: `{component.app-badge-outline}`에 12px Lucide `bot`과 "AI", 안쪽 0 6px, 올리면 "AI가 쓴 답". DM에는 달지 않는다(DM은 늘 나와 내 에이전트의 대화다).
- **GitHub 이슈 댓글**: 포스트에 올린 문답은 올린 사람의 계정으로 댓글이 된다. 올린 사람이 함께 쓴 글, 빈 줄, 그 아래 GitHub 알림 인용으로 표시를 단다.
  ```
  참고로 붙여요

  > [!NOTE]
  > 🤖 **AI가 쓴 답** · 김지은의 Claude Code (Opus · effort high)
  > 물음: 부분 환불은 어디서 금액을 계산해?

  (답)
  ```
  모델과 effort를 모르면 괄호를 뺀다. 사람이 쓴 글에는 아무 표시도 달지 않는다.

#### 문답

- **채널의 문답은 올린 사람의 메시지다.** 올린 문답과 `@호출` 모두 `{component.app-message}`처럼 아바타, 이름, 시각을 단 머리 아래에 놓인다. 머리 아래에는 함께 쓴 글(있으면, "채널에 올리기"), 그 아래 접힌 줄이 온다. 줄만 두면 바로 위 메시지를 쓴 사람의 것처럼 보여서다. 문답 메시지는 앞 메시지와 묶지 않고 늘 머리를 단다.
- **`app-qa-line`** 채널에 올라온 문답의 접힌 한 줄. 파치먼트, `{rounded.pill}`, 최소 높이 36px, 메시지 본문 안에 둔다. 에이전트 표시, "지은의 Claude Code"(600), 질문(보조 글씨, 말줄임), 오른쪽에 "펼치기". `@호출`이 아직 답하는 중이면 "펼치기" 자리에 "답하는 중…"(강조색)을 쓰고, 답이 오면 같은 줄이 바뀐다.
- **`app-qa-card`** 펼친 모습. 흰 바탕, 1px `{colors.hairline}`, `{rounded.lg}`, 안쪽 16px.
  - 머리: 에이전트 표시, 이름, "김지은이 올림 · 시각", 오른쪽에 공개 배지. 조사는 이름의 끝 글자 받침을 따른다("김지은이", "박민수가"). 한글로 끝나지 않는 이름은 조사 없이 "owner 올림"으로 쓴다.
  - 질문(15px/600), 답(`{typography.app-answer}` 마크다운)
  - 아래 구분선 위에 "본 코드", 브랜치·커밋(`{component.app-source-ref}`), 작업 중 변경이 있으면 "작업 중 변경 포함" 배지, 답한 모델 배지, 오른쪽에 "접기"
  - 채널의 카드에는 "다시 묻기"가 없다. 끊긴 `@호출`은 알림만 보이고, 다시 물으려면 주인이 입력 칸에서 다시 `@호출`한다.
- 접힌 줄과 카드의 에이전트 표시 점은 그 에이전트의 지금 상태(러너가 붙어 있는지)다.
- DM 안의 문답은 카드가 아니라 대화 모양이다("DM 칸"). 공개를 비공개로 되돌리지는 않는다.

#### 입력

- **`app-text-input`** 높이 36px, `{rounded.md}`, 1px `{colors.hairline}`, 15px. 위에 라벨(13px/600), 아래에 도움말(12px 보조).
  - 입력 중: 테두리만 `{colors.primary}`로 바뀐다. 바깥에 번지는 연한 파란 고리는 두지 않는다(2026-11-13 주인). 메시지 입력 칸, 찾기 칸, 고르기 칸도 같다.
  - 오류: 테두리 `{colors.error}`, 도움말 글씨도 `{colors.error}`, `aria-invalid`
- **`app-composer`** 메시지 입력 칸. 흰 바탕, 1px 선, `{rounded.lg}`, 안쪽 6px 6px 6px 16px. 줄이 늘어나면 200px까지 커지고 그 뒤로는 칸 안에서 스크롤한다. 오른쪽에 32px 둥근 보내기 버튼(`{component.app-send-button}`). Enter는 보내기, Shift+Enter는 줄바꿈.
  - 러너가 꺼져 있으면 `{component.app-composer-disabled}`: 파치먼트 바탕에 "Claude Code 러너가 꺼져 있어 지금은 물을 수 없어요", 보내기 버튼은 막힌다.

#### `@호출` 입력

채널 입력 칸에서 내 에이전트를 불러 처음부터 모두가 보게 묻는다(이슈 #22). DM 칸의 고르기 규칙과 `{component.app-popover}`, `{component.app-menu-item}`을 그대로 쓴다.

- **열기**: 채널 입력 칸의 맨 앞이나 공백 뒤에서 `@`를 치면, 입력 칸 바로 위에 왼쪽을 맞춰 폭 260px의 메뉴가 열린다. 메일 주소처럼 낱말 중간의 `@`로는 열리지 않는다. `@` 뒤에 친 글로 거르고(`@co` → Codex), 맞는 것이 없으면 닫힌다.
- **줄**: 맨 위에 "모두가 보게 묻기"(12px/600 보조 글씨)를 둬서 DM과 달리 공개라는 것을 알린다. 그 아래 줄은 DM 칸의 에이전트 메뉴와 같다: 에이전트 표시, 이름, 오른쪽 상태("답하는 중…"은 강조색, "쉬는 중"은 보조 글씨).
- **고를 거리**: 내 에이전트 가운데 연결된 것만 나온다. 하나여도 한 줄짜리 메뉴로 고른다. 남의 에이전트는 부를 수 없다.
- **없을 때**: 메뉴가 "연결된 에이전트가 없어요" / "이 기기에서 러너를 켜면 @로 내 에이전트를 불러 모두가 보게 물을 수 있어요."를 보인다(`role="status"`).
- **토큰**(`{component.app-call-token}`): 고르면 친 `@…`가 지워지고 입력 칸 앞에 토큰이 선다. 파치먼트 알약, 높이 28px(좁은 화면 40px), 에이전트 표시 20px, 이름 13px/600, 오른쪽에 지우기(×) 버튼이 있다. 한 번에 한 에이전트만 부른다. 토큰이 있으면 `@`로 메뉴가 다시 열리지 않고, 커서가 맨 앞일 때 Backspace도 토큰을 지운다.
- **안내 글**: 토큰이 있으면 "Claude Code에게 모두가 보게 묻기", 없으면 "# 결제에 메시지 보내기".
- **보내기 실패**: 글과 토큰을 입력 칸에 되돌리고 알림 띠를 띄운다. 러너가 꺼졌으면 "Claude Code 러너가 꺼져 있어 지금은 물을 수 없어요", 그 밖에는 "질문을 보내지 못했어요".
- **키보드**: WAI-ARIA 콤보박스(목록) 패턴이다. 초점은 입력 칸에 두고(`aria-activedescendant`), 위아래 화살표로 고르고, Enter나 Tab으로 넣고, Esc로 닫는다. 한글을 조합하는 중의 Enter는 고르지 않는다.

#### 채널에 올리기

DM의 문답을 채널 입력 칸에 붙여, 내 말과 함께 보낸다(2026-11-12 시안 13-C). 질문과 답이 함께 올라가고(답만 골라 올릴 수 없다), 올린 뒤에는 비공개로 되돌리지 않는다.

- **붙이기**: DM 문답의 "채널에 올리기"를 누르면 그 문답이 그 채널의 입력 칸에 붙고, 초점이 입력 칸의 글 줄로 간다.
  - 입력 칸 맨 위 줄에 `{component.app-qa-attachment}`가 선다: 파치먼트 알약, 높이 36px(좁은 화면 44px), 에이전트 표시 20px, "지은의 Claude Code"(13px/600), 질문(13px 보조 글씨, 말줄임), 오른쪽에 28px 빼기(×) 버튼("올릴 문답 빼기"). 글은 그 아래 줄에 쓴다.
  - 한 번에 한 문답만 붙는다. 다른 문답의 "채널에 올리기"를 누르면 붙은 것이 바뀐다. 커서가 글 맨 앞일 때 Backspace도 붙은 문답을 뺀다.
  - `@호출` 토큰과 함께 두지 않는다. 문답을 붙이면 토큰을 지우고(친 글은 둔다), 문답이 붙어 있는 동안은 `@`로 메뉴가 열리지 않는다.
  - 안내 글은 "한마디 덧붙이기 (선택)"이다. 글 없이 문답만 보내도 된다. 문답이 붙어 있으면 보내기 버튼이 켜진다.
  - 붙어 있는 동안 DM의 그 문답은 버튼 자리에 16px Lucide `corner-down-left`와 "채널 입력 칸에 넣었어요"(12px 보조)를 보인다. 빼면 버튼이 돌아온다.
  - 붙인 문답은 입력 칸의 글처럼 그 채널에만 있다. 다른 채널로 가면 빠진다.
- **좁은 화면**: 오른쪽 칸이 대화 위에 떠 있는 폭(1068px 이하)에서는 누르면 오른쪽 칸(833px 이하는 DM 화면)을 닫고 채널 입력 칸으로 간다.
- **보내기**: Enter나 보내기 버튼. 채널에 내 메시지 하나로 올라간다: 머리, 쓴 글, 접힌 문답 줄(위 "문답"). 채널은 그 메시지로 스크롤하고 `{component.app-message-highlight}`(`{colors.selected}` 바탕, `{rounded.md}`)로 칠했다가 2초 동안 걷어 낸다. 움직임 줄이기 설정이면 2초 뒤에 바로 걷는다. DM의 문답은 "# 결제에 올렸어요 · 보기"로 바뀐다.
- **보내기 실패**: 글과 붙인 문답을 입력 칸에 되돌리고 알림 띠 "채널에 올리지 못했어요"를 띄운다.

#### 부딪힘 포럼

부딪힘은 포럼 채널이다(2026-11-13 시안 14-A, Discord 포럼처럼, ADR-0027). Omagari가 알림 하나를 포스트 하나로 올리고, 사람은 포럼에서 채팅하지 않고 포스트 안에서만 이야기한다.

- **채널 패널**: "포럼 채널" 카테고리 아래에 부딪힘 줄(18px Lucide `messages-square`)이 있다. 그 밑에 열린 포스트가 가지로 달린다: 왼쪽 30px 들여 쓰고, 부딪힘 아이콘 아래에서 내려오는 1px `{colors.hairline}` 세로선 하나가 마지막 포스트까지 끊기지 않고 이어진다. 마지막 포스트에서만 └처럼 꺾고, 중간 포스트에는 가로 가지를 달지 않는다(`│ │ └`, 2026-11-13 주인). 14px 글씨, 새 글이 있으면 600과 오른쪽 8px 점. 풀린 포스트는 가지에서 빠진다.
- **머리 띠**: 20px 포럼 아이콘, "부딪힘"(`{typography.app-title}`), "Omagari가 알림을 포스트로 올려요"(12px 보조). 오른쪽 버튼은 채널과 같다.
- **찾기 칸**(`{component.app-forum-search}`): 머리 띠 아래 12px에 대화 칸 폭으로 둔다. 높이 40px, 앞에 18px 돋보기, 안내 글 "포스트 찾기 (사람, 파일, 함수)". 라벨도 훑는다. 포스트는 Omagari가 올리므로 "새 포스트" 버튼은 없다.
- **도구 줄**: 찾기 칸 아래 10px.
  - 맨 앞 "정렬과 보기"(`{component.app-tag-chip}`에 14px Lucide `arrow-up-down`과 12px 꺾쇠). 누르면 `{component.app-popover}` 메뉴: "정렬"(최근 활동, 올라온 시각)과 "보기"(목록, 카드). 고른 보기는 기기마다 기억한다.
  - 1px 세로 구분선 뒤에 태그(`{component.app-tag-chip}`, 켜면 `{component.app-tag-chip-on}`): "열림 N", "풀림 N", 그리고 포스트들의 이슈 라벨(처음 나온 순서, ADR-0032). Omagari가 이슈를 열 때 종류 라벨(직접 충돌, 간접 충돌, 중복 구현, 계약 변경)을 달고, 사람이 GitHub에서 단 라벨도 여기 선다. 라벨을 여럿 켜면 그 가운데 하나라도 단 포스트가 보인다. 처음에는 "열림"이 켜져 있다. 좁으면 넘치는 태그는 숨는다.
  - "풀림"은 알림이 풀렸거나 사람이 GitHub에서 이슈를 닫은 포스트다. 알림이 풀리면 Omagari가 이슈를 닫는다.
- **목록 보기**(기본): 포스트마다 `{component.app-forum-post}` 한 장, 사이 8px. 올렸을 때 `{colors.selected}`.
  1. 판정 아이콘(16px, 아래 "목록의 판정"), 제목 15px/600(말줄임), 그 뒤에 이슈 번호 "#44"(15px 보조 글씨, `{component.app-issue-number}`)
  2. 종류 배지(직접 충돌은 `{component.app-badge-warning}`, 그 밖은 `{component.app-badge-outline}`)를 제목 아래 줄에 두고, 간접 충돌이면 그 뒤에 판정 배지를 단다. 종류가 아닌 이슈 라벨을 그 뒤에 `{component.app-badge-outline}`으로 잇는다
  3. 마지막 글 한 줄(13px 보조, 앞에 쓴 사람 이름 600 글자색 "민수:")
  4. 사람 줄(시안 27-B, 2026-11-13 주인): 관련된 사람의 22px 아바타를 5px 겹쳐 두고, 그 뒤에 이름을 " · "로 잇는다(12px 글자색, "박민수 · 나"). 그 뒤 " · ", 16px 말풍선 아이콘과 글 수, "· 2분 전"(12px 보조)
  - 브랜치, 파일, 줄 번호는 줄에 두지 않는다. 포스트의 첫 글(알림)에 있다.
  - 풀린 포스트는 70% 흐리게 하고 제목 앞에 "풀렸어요" 테두리 배지를 단다.
- **목록의 판정**(2026-11-13 시안 29-B와 29-C를 합침): 합쳐 돌려 보기의 판정(ADR-0035)을 제목 앞 아이콘과 판정 배지 둘로 보인다. 아이콘은 16px Lucide, 보조 글씨색이고 깨짐만 `{colors.warning}`이다. `role="img"`와 판정 이름의 `aria-label`을 단다. 판정 배지는 글자만 쓴다.

  | 판정 | 아이콘 | 판정 배지 |
  | --- | --- | --- |
  | 추정(아직 돌리지 않음) | `circle-dashed` | "추정" `{component.app-badge-outline}` |
  | 돌려 보는 중 | `loader-circle`(1초에 한 바퀴, 움직임 줄이기면 멈춤) | "돌려 보는 중" 테두리 배지 |
  | 깨짐 | `circle-x` 경고색 | "깨짐" `{component.app-badge-warning}` |
  | 가릴 수 없음 | `circle-question-mark` | "가릴 수 없음" 테두리 배지 |
  | 통과(풀림) | `circle-check` | "통과" 테두리 배지 |
  | 직접 충돌 | `circle-x` 경고색 | 없음. 종류 배지가 경고색이다 |

  - 돌리지 못함은 목록에 따로 보이지 않고 "추정"으로 남는다. 까닭은 포스트의 판정 띠에 있다.
  - 중복 구현과 계약 변경은 합쳐 돌려 보지 않으므로(ADR-0036) 아이콘과 판정 배지가 없다.
  - 태그에 "확인됨"이 선다. 깨짐이 확인되면 Omagari가 이슈에 붙이는 라벨이다.
- **카드 보기**: 2열 격자, 사이 12px. `{component.app-forum-card}`에 목록 보기의 세 줄을 둔다. 2단계에서는 위쪽의 부딪힌 줄 미리 보기 칸을 두지 않는다(2026-11-13 주인, 까닭과 명세는 Known Gaps).
- **제목**에는 사람을 넣지 않는다. 사람은 사람 줄에 따로 보인다(시안 27-B). 제목은 이슈 제목과 번호("refund의 reason 필드 #44")다(ADR-0032). Omagari가 연 이슈의 제목은 부딪힌 파일(또는 심볼)과 종류("refund.ts 직접 충돌")이고, 사람이 GitHub에서 바꾸면 따라간다. 이슈를 아직 열지 못했으면 부딪힌 파일(또는 심볼)만 쓰고 번호가 없다.

#### 포스트

- **옆 칸으로 열기**(기본, 시안 14-A. 가운데에 바로 여는 14-B와 카드가 기본인 14-C는 고르지 않았다): 목록이나 카드를 누르면 오른쪽 칸이 `{component.app-post-panel}`(480px)이 되고 포럼 목록은 가운데에 남는다. 고른 줄은 `{colors.selected}` 바탕과 1px `{colors.hairline}` 안쪽 선. 오른쪽 칸 자리를 쓰므로 머리 띠 버튼은 이름 없이 아이콘만 남는다.
  - 머리(52px): 제목 17px/600(말줄임), 그 뒤에 이슈 번호 "#44"(15px 보조 글씨, GitHub의 이슈로 가는 링크, 새 탭, 올리면 강조색 밑줄), 오른쪽에 32px "크게 보기"(Lucide `maximize-2`)와 닫기(×).
  - 그 아래 대화, 맨 아래 `{component.app-composer}`(안내 글 "이 포스트에 메시지 보내기").
- **크게 보기**: 포스트가 가운데 대화 칸이 되고, 오른쪽 칸은 다시 DM이나 멤버 목록이 된다. 머리 띠는 "‹"(포럼으로 돌아가기), "부딪힘 ›"(13px 보조), 제목(`{typography.app-title}`)과 이슈 번호 링크(17px 보조), 오른쪽에 "옆 칸으로"(Lucide `minimize-2`), 내 에이전트, 멤버 목록이다. 입력 칸 안내 글은 "refund.ts에 메시지 보내기".
- **첫 글은 Omagari의 알림이다.** `{component.app-message}` 모양에 아바타 대신 `{component.app-omagari-mark}`(36px, `{colors.ink}` 바탕 둥근 네모, 흰 18px Lucide `git-merge`), 이름 "Omagari", 본문은 `{component.app-alert-card}`: 종류 배지, 두 사람과 브랜치(12px 고정폭 보조), 다음 줄에 파일과 줄 범위(12px 고정폭 보조). 알림이 고쳐지면 이 글이 바뀌고 시각 옆에 "10:38에 고침"을 붙인다.
- **첫 글의 배지**: 간접 충돌이 합쳐 돌려 보기로 확인되면 알림 카드의 배지가 "간접 충돌 · 추정"(`{component.app-badge-outline}`)에서 "간접 충돌 · 확인됨"(`{component.app-badge-warning}`)으로 바뀐다. 통과해서 닫히면 "간접 충돌 · 추정" 뒤에 "풀렸어요"가 붙는다.
- **판정 띠**(`{component.app-verdict-strip}`)는 합쳐 돌려 보기가 돌면 대화 위에 늘 붙는다(아래 "판정 띠").
- **결정 상태 띠**(`{component.app-decision-strip}`)는 결정 PR이 열리면 첫 글 아래, 대화 위에 늘 붙는다(아래 "결정 상태 띠"). 판정 띠가 있으면 그 아래다.
- **DM**: 포스트에서 연 DM 칸 머리의 둘째 줄은 "나만 보여요 · refund.ts"다. 답 아래 "채널에 올리기"는 "포스트에 올리기"가 되고, 올린 뒤에는 "이 포스트에 올렸어요 · 보기"다. 나머지는 "DM 칸"과 같다(모델·effort 칩 포함).
- **사이드바 표시**: 직접 충돌이 걸린 작업의 작업 줄 뒤에 "직접 충돌" `{component.app-badge-warning}`을 붙이고, 풀리면 뗀다. 합쳐 돌려 보기의 판정이 깨짐인 작업에는 같은 자리에 "합치면 깨짐" `{component.app-badge-warning}`을 붙인다.

#### 판정 띠

합쳐 돌려 보기의 판정(ADR-0035)은 포스트의 대화 위에 띠 한 줄로 늘 보인다(2026-11-13 시안 28-B). 알림 카드 안에 두는 28-A와 대화에 한 줄씩 쌓는 28-C는 고르지 않았다. 띠의 모양은 결정 상태 띠와 같다.

- **`app-verdict-strip`** 최소 높이 44px, `{rounded.md}`, 13px, `role="status"`. 왼쪽에 16px 판정 아이콘, 판정 이름(600), 설명(보조 글씨). 좁으면 줄을 바꾼다. 간접 충돌 포스트에만 있고, 러너가 판정을 올린 적이 없으면 띠가 없다.
- **판정**: 아이콘 · 이름 · 설명 · 띠 색
  - `loader-circle` · 돌려 보는 중 · "지은의 기기에서 npm test · 20초째" · 기본
  - `circle-x` · 깨짐 · "합치면 깨져요 · 따로 돌리면 둘 다 통과해요" · `{component.app-verdict-strip-warning}`
  - `circle-check` · 통과 · "합쳐도 통과해서 포스트를 닫았어요 · npm test · 방금" · 기본
  - `circle-question-mark` · 가릴 수 없음 · "민수의 작업만 돌려도 깨져요" · 기본
  - `circle-minus` · 돌리지 못함 · 까닭을 쓴다: "레포에 검사 명령이 없어요 · 정하는 법", "지은의 기기에 샌드박스 도구가 없어요 · 까는 법", "5분이 넘어 끊었어요 · 통과로 치지 않아요", "직접 충돌을 먼저 풀어야 돌려 볼 수 있어요" · 기본. "정하는 법"과 "까는 법"은 강조색 링크다.
  - 지난 결과: 돌린 뒤에 내용이 바뀌었으면 이름 뒤에 " · 지난 결과"를 붙이고 설명은 "내용이 바뀌어서, 잠잠해지면 다시 돌려요", 띠 색은 기본이다.
- **출력**: 깨짐이면 오른쪽 끝에 "출력 보기"(`{component.app-button-quiet}`, 높이 28px, `aria-expanded`)가 있다. **출력은 접힌 채가 기본이다**(2026-11-13 주인). 누르면 띠 아래 6px에 한 줄(12px 고정폭 보조 글씨, "npm test · 48초 · 지은의 기기 · 2분 전")과 출력 칸이 펼쳐지고 버튼은 "출력 접기"가 된다.
  - **`app-verdict-output`** 흰 바탕, 1px `{colors.hairline}`, `{rounded.sm}`, 안쪽 10px 12px, 12px 고정폭, 줄 높이 1.55. 줄을 바꾸지 않고 가로로 스크롤한다. 출력의 끝부분만 보인다.
  - 출력을 올리지 않은 판정(공유 수준이 full이 아닌 러너)에는 "출력 보기"가 없다.
- **색**: 경고색은 깨짐에만 쓴다. 통과에 초록을 쓰지 않는다(강조색은 하나).
- **띠가 둘일 때**: 결정 PR이 열려 있으면 판정 띠가 위, 결정 상태 띠가 아래이고 사이는 6px이다.

#### 결정 정리하기

내 에이전트가 포스트를 읽고 초안을 쓰고, 사람이 읽고 고쳐서 결정 PR을 연다(2026-11-13 주인, ADR-0028). 에이전트끼리 토론해 정하는 것은 4단계다.

- **들어가기**: 포스트 머리 띠의 "결정 정리하기"(`{component.app-header-button}`, 18px Lucide `pen-line`, 이름 13px이 늘 보임). 누르면 `{component.app-dialog}`가 폭 560px, 높이 776px로 열리고 바로 초안을 쓰기 시작한다.
- **초안 띠**(`{component.app-draft-band}`): 대화 상자 제목 아래. 에이전트 표시 20px, 제목 13px/600, 설명 13px 보조, `role="status"`.
  - 쓰는 중: "지은의 Claude Code가 초안을 쓰는 중" / "이 포스트의 글 6개와 문답 1개를 읽고 있어요". 오른쪽에 "그만 쓰기"(`{component.app-button-quiet}`, 높이 28px). 네 칸은 `{component.app-skeleton}` 막대(높이 14px, 칸마다 1~3줄)이고 폼에 `aria-busy`. 움직임 줄이기 설정이 아니면 1.4초로 옅어졌다 돌아온다.
  - 다 씀: "지은의 Claude Code가 쓴 초안이에요" / "포스트의 글 6개와 문답 1개를 읽고 썼어요. 읽어 보고 고친 뒤 여세요." 오른쪽에 답한 모델 배지. 초안을 쓰는 모델과 effort는 DM에 기억된 값이다.
  - 러너가 꺼짐: `{colors.warning-bg}` 바탕, `{colors.warning}` 글씨로 "초안을 쓸 수 없어요" / "Claude Code 러너가 꺼져 있어요. 직접 쓰거나, 러너를 켜고 다시 쓰게 하세요." 칸은 비어 있고 안내 글이 보인다.
  - 그만 쓰게 했으면 "초안 쓰기를 멈췄어요" / "직접 쓰거나 다시 쓰게 하세요."
- **칸**: 2열. 제목(한 줄, 두 열), 맥락과 결정(4줄씩 나란히), 결과(2줄, 두 열). 입력 모양은 `{component.app-text-input}`이고 14px. 안내 글은 "무엇을 정했나요", "왜 정해야 했나요", "무엇으로 정했나요", "그래서 무엇이 바뀌나요".
- **이의 창**(ADR-0030): 나눔 단추 "바로", "1시간", "하루"(기본), "3일", "직접". "직접"을 고르면 아래에 숫자 칸(폭 72px, 높이 32px, 기본 12)과 단위 고르기(시간, 일), "동안"이 한 줄로 선다. 그 아래 설명(12px 보조):
  - 바로: "열자마자 머지해요. 이의를 낼 틈이 없으니 되돌리기 쉬운 것만 고르세요."
  - 그 밖: "하루 동안 아무도 이의를 내지 않으면 머지해요. 결정자가 모두 동의하면 더 일찍 머지해요."처럼 고른 길이를 쓴다.
- **저절로 붙는 것**: `{colors.selected}` 상자에 결정자(이 포스트에서 말한 멤버의 아바타와 이름)와 출처(이 포스트 링크, 강조색).
- **아래**: 오른쪽 정렬 한 줄 "지은의 이름으로 Pancheble/omagari에 결정 PR을 열어요."(12px 보조). 그 아래 왼쪽에 "다시 쓰게 하기"(초안이 없으면 "초안 쓰게 하기"), 오른쪽에 "취소"와 "결정 PR 열기". "결정 PR 열기"는 초안을 다 썼거나 사람이 칸을 채웠을 때만 켜진다.

#### 결정 상태 띠

결정 PR의 상태는 포스트 첫 글 아래의 띠 한 줄로 늘 보인다(2026-11-13 시안 15-A). 같은 줄이 포럼 목록에는 보이지 않는다.

- **`app-decision-strip`** 최소 높이 44px, `{rounded.md}`, 13px, `role="status"`. 왼쪽에 16px Lucide `git-pull-request`, 상태 이름(600), 설명(보조 글씨)과 "PR #12" 링크(강조색), 오른쪽 끝에 버튼(높이 28px, 13px). 좁으면 줄을 바꾼다.
- **상태**: 이름 · 설명 · 띠 색
  - 제안됨 · "18시간 남음 · 동의 1/2 · 결정자가 모두 동의하면 바로 머지해요" · 기본
  - 이의 N개 · "민수가 이의를 냈어요 · 모두 거둬질 때까지 머지하지 않아요" · `{component.app-decision-strip-warning}`
  - 다시 열림 · "이의가 모두 거둬져 창을 다시 열었어요 · 24시간 남음 · 동의 1/2" · 기본
  - 머지 막힘 · "창은 닫혔지만 GitHub이 막았어요: 지은 말고 다른 멤버의 리뷰 승인이 필요해요 · 풀리면 바로 머지해요"(검사 실패, 충돌도 같은 자리에 까닭을 쓴다) · 경고
  - 머지 멈춤 · "지은의 GitHub 토큰이 듣지 않아 머지를 멈췄어요 · 지은이 다시 로그인하면 이어 가요" · `{component.app-decision-strip-error}`
  - 수락됨 · "docs/decisions/0003-calc-refund-signature.md로 머지했어요"(모두 동의해 일찍 머지했으면 "결정자가 모두 동의해 창을 일찍 닫고 …") · 기본
  - 버림 · "지은이 결정을 버려 결정 PR을 닫았어요" · 바탕 없음, 보조 글씨
- **버튼**: 보는 사람에 따라 다르다.
  - 정리한 사람이 아닌 결정자: "동의"(`{component.app-button}`)와 "이의"(`{component.app-button-outline}`). 정리한 사람은 연 것으로 동의한 셈이다. 결정자가 모두 동의하면 창을 일찍 닫고 바로 머지한다(ADR-0029).
  - 결정자가 아닌 멤버: "이의"만.
  - 이의를 낸 사람: "내 이의 거두기"(`{component.app-button-outline}`).
  - 정리한 사람: "고쳐 올리기"(`{component.app-button-quiet}`)와 "버리기"(`{component.app-button-danger}`). 머지되거나 버린 뒤에는 버튼이 없다.
- **대화의 한 줄**: 결정 PR이 열리고, 동의·이의·거둠이 나고, 머지되거나 닫힐 때마다 포스트에 Omagari의 한 줄이 쌓인다: 16px 아이콘, "Omagari · 지은이 결정 PR #12를 열었어요 · 이의 창 하루 · 오전 10:50"(13px 보조, 안쪽 4px 20px 4px 24px).

#### 설정 창

상태 메뉴의 "설정"으로 여는 창이다(2026-11-13 시안 16-B, macOS 시스템 설정처럼). 항목은 필요할 때 더한다.

- **`app-settings-window`** 820×580px, `{rounded.lg}`, 뒤 덮개 `{colors.overlay}`, `role="dialog"`와 `aria-modal`. Esc, 덮개 누르기, 오른쪽 위 32px 닫기(×)로 닫힌다.
- **왼쪽 목록**(220px, 파치먼트, 오른쪽 1px 선, 안쪽 16px 10px): 맨 위에 내 아바타 36px, 이름, GitHub 아이디. 그 아래 묶음 제목(12px/600 보조)과 `{component.app-settings-item}` 줄(높이 36px, 18px 아이콘과 15px 이름, 올렸을 때 `{colors.hover}`, 고른 줄은 `{colors.selected}`와 600, `aria-current`).
  - "나": 내 에이전트
  - "워크스페이스 · omagari": 부딪힘 알림
- **오른쪽**: 파치먼트 바탕, 안쪽 4px 28px 28px. 위에 고른 항목 이름(`{typography.app-title}`, 높이 60px 줄). 그 아래 묶음 사이 24px.
  - 묶음 제목(13px/600 보조, 안쪽 0 16px 6px), `{component.app-settings-group}`(흰 바탕, `{rounded.md}`, 1px 선), 그 아래 설명(12px 보조, 안쪽 6px 16px 0).
  - `{component.app-settings-row}`(최소 높이 52px, 안쪽 10px 16px, 줄 사이 1px 선): 왼쪽에 이름(15px)과 설명(13px 보조), 오른쪽에 조작(스위치, 고르기 단추, 링크, 배지).
- **`app-switch`** 40×24px, 흰 20px 손잡이, 꺼짐 `{colors.offline}`, 켜짐 `{component.app-switch-on}`, 150ms. `role="switch"`, `aria-checked`, 이름과 설명을 `aria-labelledby`·`aria-describedby`로 잇는다.
- **내 에이전트**:
  - "남이 물을 때": "남의 질문에 답하기" 스위치(기본 켜짐, ADR-0024). 설명은 켜짐 "다른 멤버의 에이전트가 물으면 내 에이전트가 내 폴더를 읽고 답해요.", 꺼짐 "꺼 두었어요. 묻는 쪽은 바로 "받지 않는다"를 들어요." 다음 줄 "내 에이전트가 답한 것"(설명 "지난 7일 동안 3번 · 마지막은 민수의 Codex가 물은 calcRefund()", 오른쪽 "기록 보기 ›" 강조색). 묶음 아래 "답할 때는 내 기기의 러너가 내 폴더를 읽기만 하고, 내 사용량이 쓰여요."
  - "연결된 에이전트": 에이전트마다 한 줄. 에이전트 표시, 이름, "이 기기 · 러너 켜짐", 오른쪽 "연결됨" 테두리 배지. 러너가 꺼진 것은 표시를 50% 흐리게, "러너가 꺼져 있어요", 오른쪽 "꺼짐"(12px 보조).
- **부딪힘 알림**:
  - "부딪힘 알림": "알림을 올릴 포럼" 줄의 오른쪽에 고르기 단추(높이 28px, `{colors.selected}` 바탕, `{rounded.sm}`, 포럼 아이콘, 이름, 꺾쇠). 고를 수 있는 것은 포럼 채널뿐이다. 묶음 아래 "바꾸면 새 알림부터 그 포럼에 올라가고, 지난 포스트는 그대로 있어요. 모든 멤버에게 같아요."
  - "합쳐 돌려 보기"(2026-11-13 시안 30-C. 새 항목을 만드는 30-A와 내 에이전트 아래에 두는 30-B는 고르지 않았다): "알림을 올릴 포럼" 묶음 아래에 둔다. 스위치가 없다. 켜고 끄는 것은 웹이 아니라 러너에서 한다(ADR-0034).
    - "검사 명령" 줄: 설명 "합친 것에 돌리는 명령이에요.", 오른쪽에 명령(13px 고정폭 보조 글씨, 읽기만). 레포에 설정 파일이 없으면 설명 "레포에 설정 파일이 없어요. 머지하면 돌리기 시작해요.", 오른쪽에 "정하는 법 ›"(강조색).
    - "내 러너에서 돌리기" 줄: 켜짐이면 설명 "켜져 있어요. 샌드박스 안에서만 돌아요."와 "켜짐" 테두리 배지. 꺼 두었으면 "꺼 두었어요. 다른 멤버의 러너가 돌린 판정은 그대로 보여요."와 "꺼짐"(12px 보조). 샌드박스 도구가 없으면 "이 기기에 샌드박스 도구가 없어 돌리지 않아요."와 "까는 법 ›"(강조색). 러너가 꺼져 있으면 "러너가 꺼져 있어요."와 "꺼짐".
    - 묶음 아래 설명: "레포 기본 브랜치의 설정 파일에서 읽어요. 바꾸려면 그 파일을 고쳐 머지하세요. 모든 멤버에게 같아요. 켜고 끄는 것은 웹이 아니라 러너에서 해요. 서버가 내 기기에서 돌릴 것을 정하지 못하게 하려는 거예요."
  - "워크스페이스": 이름과 레포(13px 고정폭), 읽기만 한다.

#### 버튼

- **`app-button`** 높이 32px, `{rounded.pill}`, 14px. 기본은 파란 바탕이다.
- **`app-button-outline`** 테두리만, **`app-button-quiet`** 바탕 없음(취소 등), **`app-button-danger`** 오류색 글씨(나가기 등), **`app-button-disabled`** 칩 바탕에 보조 글씨.
- 한 화면에 파란 바탕 버튼은 하나만 둔다.

#### 배지

- **`app-badge`** 높이 20px, `{rounded.pill}`, 12px. 쓰임은 일곱이다.
  - 공개: `{component.app-badge-outline}`. 채널에서 펼친 문답 카드의 머리에만 단다. DM에는 공개 범위 배지가 없다("DM 칸").
  - 작업 중 변경 포함: `{component.app-badge-warning}`
  - N시간 전 기준: 테두리 배지 앞에 11px 시계 아이콘
  - 답한 모델: `{component.app-badge-outline}`에 "Opus · high"처럼 모델과 effort. "기본"으로 물었으면 실행기가 알려 준 실제 모델 이름을 쓰고, 모르면 배지를 달지 않는다.
  - AI가 쓴 답: `{component.app-badge-ai}`("AI가 쓴 글")
  - GitHub에서 들어온 댓글: `{component.app-badge-outline}` "GitHub"("메시지")
  - 판정: 포럼 목록의 판정 배지("부딪힘 포럼"의 "목록의 판정")와 작업 줄의 "합치면 깨짐". 깨짐만 `{component.app-badge-warning}`, 나머지는 `{component.app-badge-outline}`

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
- 앱: 채널 패널을 처음부터 접어 두지 않는다. 처음 보는 사람이 채널을 찾지 못한다.
- 앱: 떠 있는 메뉴를 패널 가장자리에서 자르거나, 쓰던 글 위에 열지 않는다.

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
| 1069px 이상 | 세 칸(채널 패널, 대화, 오른쪽 칸). 채널 패널을 접으면 대화와 오른쪽 칸 두 칸 |
| 834–1068px | 채널 패널과 대화 두 칸. 오른쪽 칸은 대화 위에 겹쳐 열린다(폭 320px, 떠 있는 층). 채널 패널을 접으면 대화만 |
| 833px 이하 | 대화만. 머리 띠 왼쪽 메뉴 버튼이 채널 패널(프로필 포함)을 왼쪽 서랍으로 연다. 포스트와 내 에이전트(DM)는 채널처럼 화면 전체를 쓰는 대화로 연다: 덮개, 둘레 여백, 둥근 모서리 없이 머리 띠와 입력 칸이 채널과 같은 자리에 있고, 머리 띠 왼쪽 "‹"로 전 화면에 돌아간다. 포스트의 "크게 보기"는 숨긴다(2026-11-13 주인). 멤버 목록은 아래에서 올라오는 전체 높이 시트다. 버튼과 줄은 44px |

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
- 앱: 결정함과 결정 보기는 아직 부품이 없다(2단계 문답 Q9). "기록 보기"가 여는 답한 기록 화면도 아직 없다.
- 앱: 사람이 포럼 채널을 따로 만들 수 있게 할지는 정하지 않았다. 지금 포럼 채널은 부딪힘 하나다.
- 앱: 합쳐 돌려 보기의 설정 파일 이름과 러너에서 끄는 명령의 이름은 정하지 않았다(ADR-0034). 시안은 `.omagari.json`과 `omagari runner --merge-check off`로 그렸다. 좁은 화면의 판정 띠는 따로 그리지 않았고, 결정 상태 띠처럼 줄을 바꾼다.
- 앱: 포럼 카드 보기의 부딪힌 줄 미리 보기는 나중에 한다(2026-11-13 주인이 2단계에서 뺌). 알림에는 줄 번호만 있고, 줄 내용을 실으려면 러너가 공유 수준(ADR-0007)대로 내용을 싣는 계약 변경이 필요하다. 카드 보기는 기본 보기도 아니다. 넣을 때의 명세: 카드 위쪽, 12px 고정폭, 줄 높이 1.55, 안쪽 14px 16px. 직접 충돌은 `{colors.warning-bg}` 바탕에 두 사람의 줄을 `{colors.warning}`, 정의 줄 변경은 `{colors.selected}` 바탕에 -/+ 두 줄.
- 앱: 실행기가 늘어나면 `app-agent-mark`의 약자를 여기에 더한다(지금은 `CC`, `CX`).
- 앱: 컴포넌트에 쓴 `borderColor`, `iconColor`, `shadow`, `backdropFilter`, `maxWidth` 같은 속성과 글자 값 하나씩 가리키기(`fontSize` 등)는 design.md 규격 검사기에서 "모르는 속성" 경고로 나온다. 오류가 아니라 경고이고, gstack 검사기가 모든 참조를 풀 수 있게 하려고 이렇게 쓴다.
