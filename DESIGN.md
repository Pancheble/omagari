---
version: alpha
name: Omagari
description: Design system for the Omagari web app. Based on an analysis of Apple's website (photo-first screens, a single blue accent, SF Pro headlines with negative letter-spacing), plus the components and Korean typeface the stage 1 app screens need (issue #17).

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
  app-label-badge:
    backgroundColor: transparent
    borderColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: 22px
    padding: 0 9px 0 8px
  app-importance-discuss:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.pill}"
    height: 20px
    padding: 0 8px
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
  app-composer-gif:
    backgroundColor: transparent
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    size: 32px
  app-reaction:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: 12px
    fontWeight: 600
    rounded: "{rounded.pill}"
    height: 24px
    padding: 0 8px
  app-profile-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    width: 320px
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
  app-debate-strip:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-caption.fontFamily}"
    fontSize: "{typography.app-caption.fontSize}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 6px 8px 6px 14px
  app-debate-card:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    fontFamily: "{typography.app-body.fontFamily}"
    fontSize: 14px
    rounded: "{rounded.md}"
    padding: 10px 12px
  app-spoiler:
    backgroundColor: "{colors.dark-chip}"
    textColor: "{colors.dark-text-secondary}"
    rounded: "{rounded.pill}"
    height: 20px
    width: 136px
  app-debate-card-ghost:
    backgroundColor: transparent
    borderColor: "{colors.hairline}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: 10px 12px
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
    width: 980px
    height: 676px
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

### Omagari app

The analysis above comes from Apple's marketing site. Omagari app screens use the same base (white and parchment backgrounds, a single blue accent, undecorated surfaces), but they're denser, because people stay in a chat app all day. The "App" subsections below set that difference. On app screens (`area:web`), when a marketing value and an app value differ, follow the app value.

These subsections were decided on 2026-11-11 in issue #17, after looking at the drafts (the "Decided" page of the draft canvas).

| What            | Decided                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App frame       | Three floating panels: Channels on the left, the conversation in the middle, Members or My agent on the right                                                               |
| Right panel     | The member list and My agent (DM) each open from their own button in the channel header bar. Only one is open at a time                                                     |
| Member list row | Collapsed by default. Status message and Work count under the name; expanding shows the Work lines                                                                          |
| Agent           | One per executor (ADR-0015). In an expanded row, each Work gets its agent mark, and agents with no Work get one line at the end. The agent mark is an executor abbreviation |
| Profile panel   | Bottom left. Avatar, presence, name, status message. Pressing it opens the status menu                                                                                      |
| Typeface        | IBM Plex Sans KR; IBM Plex Mono for code. Korean letter-spacing 0                                                                                                           |
| Message         | List style, 15px body                                                                                                                                                       |
| Q&A             | A collapsed single line and a bordered card                                                                                                                                 |
| Dark mode       | Only the color values are set; stage 1 screens ship light mode only                                                                                                         |

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

### Colors added for the app

- **Secondary text** (`{colors.text-secondary}` — #636366): small secondary text like times, branches, section titles, and descriptions. It's above 6.0:1 on white, 5.5:1 on parchment, and 4.5:1 even on a selected row.
- **Row states**: hover `{colors.hover}` (black 4%), selected `{colors.selected}` (black 6%). Since these are colors layered over transparency, use `{colors.selected-solid}` where the layered result has to be a single color (the ring around the presence dot).
- **Presence**: online `{colors.online}` #248a3d, away `{colors.away}` #c27c0e, do not disturb `{colors.dnd}` #d70015, offline `{colors.offline}` #8e8e93. They're told apart by the dot's shape as well as color (component "Presence dot").
- **Error and warning**: error `{colors.error}` #d70015 / background `{colors.error-bg}`, warning `{colors.warning}` #b25000 / background `{colors.warning-bg}`. Text on both backgrounds is above 4.5:1.
- **Chip and skeleton**: `{colors.chip}` #e8e8ed is used for avatar backgrounds, disabled buttons, and the gray bars while loading.
- **Overlay and ring**: the overlay behind dialogs is `{colors.overlay}` (black 32%). Inputs get no focus ring (see "Input" below).
- **There's still only one accent color.** The presence, error, and warning colors tell you a state; only `{colors.primary}` signals that something is pressable.

### Dark mode

Dark mode color values are set as `dark-*` tokens. Stage 1 screens ship light mode only; dark mode that follows the system setting is put off until later.

| Role              | Light                       | Dark                                   |
| ----------------- | --------------------------- | -------------------------------------- |
| Window background | `{colors.canvas}`           | `{colors.dark-window}` #1d1d1f         |
| Panel             | `{colors.canvas-parchment}` | `{colors.dark-panel}` #272729          |
| Input             | `{colors.canvas}`           | `{colors.dark-field}` #2a2a2c          |
| Chip              | `{colors.chip}`             | `{colors.dark-chip}` #3a3a3c           |
| Text              | `{colors.ink}`              | `{colors.dark-text}` #ffffff           |
| Secondary text    | `{colors.text-secondary}`   | `{colors.dark-text-secondary}` #a1a1a6 |
| Line              | `{colors.hairline}`         | `{colors.dark-line}` (white 14%)       |
| Selected row      | `{colors.selected}`         | `{colors.dark-selected}` (white 8%)    |
| Warning text      | `{colors.warning}`          | `{colors.dark-warning}` #ffb340        |

Accent icons on a dark background use `{colors.primary-on-dark}`. That blue doesn't reach 4.5:1 as small text, so text like the name in a selected row stays white and only the icon turns blue.

## Typography

### Font Family

- **Display**: `SF Pro Display, system-ui, -apple-system, sans-serif` — Apple's proprietary display face, optimized for sizes ≥ 19px. Defines the voice of every headline.
- **Body / UI**: `SF Pro Text, system-ui, -apple-system, sans-serif` — the text-optimized variant used for body copy, captions, buttons, and links below 20px.
- **OpenType features**: `font-variant-numeric: numerator` is enabled on numeric links (pricing tables, spec sheets). Display sizes rely on tight tracking rather than contextual ligatures.

### Hierarchy

| Token                         | Size | Weight | Line Height | Letter Spacing | Use                                                    |
| ----------------------------- | ---- | ------ | ----------- | -------------- | ------------------------------------------------------ |
| `{typography.hero-display}`   | 56px | 600    | 1.07        | -0.28px        | Hero headline; the signature "Apple tight" tracking    |
| `{typography.display-lg}`     | 40px | 600    | 1.10        | 0              | Tile headlines atop every product tile                 |
| `{typography.display-md}`     | 34px | 600    | 1.18        | -0.374px       | Section heads (SF Pro Text at display proportions)     |
| `{typography.lead}`           | 28px | 400    | 1.14        | 0.196px        | Product tile subcopy                                   |
| `{typography.lead-airy}`      | 24px | 300    | 1.5         | 0              | Environment-page lead paragraphs (the rare weight 300) |
| `{typography.tagline}`        | 21px | 600    | 1.19        | 0.231px        | Sub-tile tagline; sub-nav category name                |
| `{typography.body-strong}`    | 17px | 600    | 1.24        | -0.374px       | Inline strong emphasis                                 |
| `{typography.body}`           | 17px | 400    | 1.47        | -0.374px       | Default paragraph                                      |
| `{typography.dense-link}`     | 17px | 400    | 2.41        | 0              | Footer / store utility link lists (relaxed leading)    |
| `{typography.caption}`        | 14px | 400    | 1.43        | -0.224px       | Secondary captions, button text                        |
| `{typography.caption-strong}` | 14px | 600    | 1.29        | -0.224px       | Emphasized captions                                    |
| `{typography.button-large}`   | 18px | 300    | 1.0         | 0              | Store hero CTAs (the rare weight 300)                  |
| `{typography.button-utility}` | 14px | 400    | 1.29        | -0.224px       | Utility/nav button labels                              |
| `{typography.fine-print}`     | 12px | 400    | 1.0         | 0              | Fine-print, footer body                                |
| `{typography.micro-legal}`    | 10px | 400    | 1.3         | 0              | Micro legal disclaimers                                |
| `{typography.nav-link}`       | 12px | 400    | 1.0         | 0              | Global nav menu items                                  |

### Principles

- **Negative letter-spacing at display sizes.** Headlines at 17px and up carry a slight tracking tighten (`-0.224 → -0.374px`). This produces the iconic "Apple tight" headline cadence. Never used at 12px or below.
- **Body copy at 17px, not 16px.** Apple breaks the SaaS convention and runs paragraph text at 17px. The extra pixel gives the page an unmistakable "reading, not scanning" pace. (The app runs denser; see App typeface and Korean.)
- **Weight 300 is real and rare.** Used deliberately on a handful of large-size reads (`{typography.button-large}` at 18px/300 and `{typography.lead-airy}` at 24px/300). It's a light-atmosphere cue reserved for moments where the content should feel airy.
- **Weight 600 for headlines and the tagline.** The ladder is 300 / 400 / 600. Weight 500 and 700 are not used.
- **Line-height is context-specific.** Display sizes use 1.07–1.19 (tight). Body uses 1.47. Utility link stacks in the footer/store use an unusually relaxed 2.41 (`{typography.dense-link}`). The 2.41 is how the footer's dense link columns breathe.

### Note on Font Substitutes

SF Pro is Apple's proprietary system font. When building off-system:

- Use `system-ui, -apple-system, BlinkMacSystemFont` as the first stack entry — on macOS/iOS/Safari this resolves to the real SF Pro.
- For non-Apple platforms, **Inter** (Google Fonts, variable) is the closest open-source equivalent. Inter at weight 600 with `font-feature-settings: "ss03"` approximates SF Pro's rounded "a" character.
- Nudge `letter-spacing` down by `-0.01em` on display sizes to re-create the Apple tight feel; Inter's default tracking runs slightly wider than SF Pro.
- For body text, tighten line-height by `0.03` (from 1.47 → 1.44) when substituting Inter — Inter's taller x-height needs less leading.

### App typeface and Korean

- **Typeface**: the app uses **IBM Plex Sans KR** (400, 600), and **IBM Plex Mono** (400) for code, branches, and commits. Both are under the SIL Open Font License, so you can get them from Google Fonts or host them yourself. System fonts are only the fallback for when the fonts can't load, so the look doesn't change from one operating system to the next.
- **Letter-spacing**: app text that includes Korean uses letter-spacing 0. Tightening Korean letter-spacing makes the characters stick together and hard to read. Negative letter-spacing is only for Latin headlines of 21px and up on marketing screens.
- **Size**: app body text is 15px. A chat app needs more conversation visible on one screen, so it's smaller than the 17px marketing body. To keep the hierarchy from going flat, the channel title goes up to 20px (1.33x the body).
- **Nothing goes below 11px.** Text people have to read, like names, marks, times, and badges, is 11px or more. The agent marks (`CC`, `CX`) are 11px too, so the mark box is never made smaller than 20px.

| Token                          | Size | Weight | Line Height | Used for                                                      |
| ------------------------------ | ---- | ------ | ----------- | ------------------------------------------------------------- |
| `{typography.app-title}`       | 20px | 600    | 1.2         | Channel name in the channel header bar                        |
| `{typography.app-heading}`     | 17px | 600    | 1.24        | Workspace name, dialog title                                  |
| `{typography.app-body}`        | 15px | 400    | 1.47        | Messages, channel rows, inputs                                |
| `{typography.app-body-strong}` | 15px | 600    | 1.3         | Person names, the selected channel                            |
| `{typography.app-answer}`      | 15px | 400    | 1.6         | Agent answers (Markdown)                                      |
| `{typography.app-caption}`     | 13px | 400    | 1.38        | Status message, Work lines, collapsed Q&A, alert bar          |
| `{typography.app-micro}`       | 12px | 400    | 1.33        | Times, branches, badges, tooltips, help text                  |
| `{typography.app-section}`     | 12px | 600    | 1.33        | Section titles ("Channels" (채널), "Online — 3" (온라인 — 3)) |
| `{typography.app-mark}`        | 11px | 600    | 1.0         | Agent mark                                                    |
| `{typography.mono}`            | 13px | 400    | 1.55        | Code blocks, inline code                                      |
| `{typography.mono-small}`      | 12px | 400    | 1.33        | The branch and commit an answer looked at                     |

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

### App frame

- **Window**: the window background is `{colors.canvas}`, and the three panels sit inside it with 8px padding and 8px gaps. The Channels panel on the left is 240px, the conversation (the remaining width) is in the middle, and the right panel is 300px.
- **Floating panels**: the Channels panel and the right panel are `{component.app-side-panel}` and `{component.app-right-panel}`. They use a parchment background, `{rounded.lg}` 18px, and an inner 1px line (black 6%). The conversation isn't a panel; it sits directly on the window background.
- **Only one right panel**: only one of the member list, My agent (DM), or a Post opened in the side panel (480px, "Conflict forum") is open at a time. The two buttons in the channel header bar open them, and pressing the same button again closes it. When it closes, the conversation gets wider.
- **The Channels panel collapses** (834px and up): collapsing removes the panel from the layout, and the conversation widens to 8px from the window's left edge. While it's collapsed, you can peek at it from the window's left edge. It starts expanded. Details are in "Collapsing the Channels panel".
- **Conversation**: from the top, the header bar (52px, with a `{colors.divider}` line below), the message list (stacks upward), then the input. Message lines never go past 720px.

## Elevation & Depth

| Level                | Treatment                                                     | Use                                                                         |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Flat                 | No shadow, no border                                          | Full-bleed tiles, global nav, footer, body sections                         |
| Soft hairline        | 1px `{colors.hairline}` border                                | Utility cards, inputs, chips, the Q&A card                                  |
| Backdrop blur        | `backdrop-filter: saturate(180%) blur(20px)` on Parchment 80% | Sub-nav and the iPhone buy floating sticky bar                              |
| Floating layer (app) | 1px `{colors.hairline}` + `0 8px 24px rgba(0, 0, 0, 0.12)`    | Menus, the time picker in the status menu, dialogs, a peeked Channels panel |
| Product shadow       | `rgba(0, 0, 0, 0.22) 3px 5px 30px 0`                          | Product renders resting on a surface                                        |

**Shadow philosophy.** Apple uses exactly one drop-shadow, and it is applied to photographic product imagery — never to cards, never to buttons, never to text. Elevation in the UI comes from (a) surface-color change (light tile ↔ dark tile) and (b) backdrop-blur on sticky bars. The single shadow is about giving the product weight, not about UI hierarchy.

**One exception in the app.** Only layers that float briefly over another screen, like menus and dialogs, get a shadow. With just a line, they'd blend into the screen behind and you couldn't tell where the menu ends. Cards, panels, buttons, and text still get no shadow.

### Decorative Depth

- **Atmospheric imagery** on the environment page (photographic vista) supplies mood; no CSS gradient involved.
- **Edge-to-edge tile alternation** creates rhythm without borders or shadows — the color change itself is the divider.
- **Backdrop-filter blur** on `{component.sub-nav-frosted}` and `{component.floating-sticky-bar}` creates a "floating over content" effect that's functional, not decorative.

## Shapes

### Border Radius Scale

| Token            | Value        | Use                                                                                                            |
| ---------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `{rounded.none}` | 0px          | Full-bleed product tiles (no corner rounding)                                                                  |
| `{rounded.xs}`   | 5px          | Agent mark, inline code, tooltips, loading bars                                                                |
| `{rounded.sm}`   | 8px          | Dark utility buttons; in the app: channel rows, header bar buttons, menu rows                                  |
| `{rounded.md}`   | 11px         | Pearl Button capsules; in the app: inputs, code blocks, alert bars, menus, the profile panel, member list rows |
| `{rounded.lg}`   | 18px         | Store utility cards; in the app: floating panels, Q&A cards, the message input, dialogs                        |
| `{rounded.pill}` | 9999px       | Primary blue pill CTAs, search input; in the app: buttons, badges, a collapsed Q&A                             |
| `{rounded.full}` | 9999px / 50% | Circular control chips; in the app: person avatars, presence dots, the send button                             |

### Photography Geometry

- **Hero imagery**: full-bleed, 21:9 or taller on the homepage; 16:9 on environment and shop pages. Product renders are photographic-realistic, often shot on a tinted surface that becomes the tile background.
- **Product renders**: PNG/WebP with transparency; rest on a surface tile and pick up the system shadow.
- **Accessory grid**: square 1:1 crops at `{rounded.lg}` (18px) radius, light neutral backgrounds, product centered with 20–40px internal padding.
- **No rounded imagery in hero tiles** — images are full-bleed rectangular. Rounding (`{rounded.sm}`, `{rounded.lg}`) appears only on inline card imagery.
- Lazy-loading via responsive `srcset` and `sizes` across all breakpoints; CDN-optimized WebP.

### App shape rules

- **People are circles, agents are rounded squares.** You can tell a person from an agent by the avatar's shape alone.
- **Icons**: use Lucide (ISC license). Stroke 1.5px, and only three sizes: 16, 18, and 20px. Company logos and emoji aren't used as icons (emoji only appear in text people write (status messages, messages, reactions) and inside the emoji palette).

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

### App components

App components all start with `app-`. They document hover too. Pressing shrinks to 0.95× and back (120ms ease-out), and keyboard focus shows a 2px `{colors.primary-focus}` ring.

#### Channel panel

- **`app-side-panel`** The top is a name row for where you are now: account avatar, small account name, bold repo name (see "Workspace and repos" below). This row is the repo picker.
- From stage 5, the panel always belongs to one place (one repo, or the whole account; see "Workspace and repos" below). The channel row, forum row, and category rules below are the same everywhere.
- **Categories**: channels are grouped by kind. There are two: "Chat channels" (채팅 채널) and, below it, "Forum channels" (포럼 채널) (2026-11-13 draft 14-A). Forum channels start with "Discussion" (논의) and "Reference" (참고), and any member can add more (ADR-0039, see "Conflict forum" below). There are no categories people make themselves.
  - The header is 28px tall, `{rounded.sm}`. The name is on the left (`{component.app-section-title}`, 12px/600 secondary text), then a 12px chevron, and a 28px `+` button on the far right ("Create chat channel" (채팅 채널 만들기), "Create forum" (포럼 만들기)).
  - The chevron and `+` show only when you hover the header (background `{colors.hover}`) or when keyboard focus is inside it (`:focus-within`). On narrow touch screens (833px and below) they're always visible. When they're hidden, their space stays, so the row doesn't shift.
  - Pressing the name collapses and expands the category (`aria-expanded`). The chevron points down when open and right when collapsed, and turns in 150ms. A collapsed category still keeps the selected channel visible. The collapsed state is remembered per device.
  - The `+` on both categories opens the same "Create" dialog (`{component.app-dialog}`, 560px wide) (2026-11-18 draft 88-A, like Discord's create channel. 88-B, a small menu on each `+`, and 88-C, a single `+` above the panel, weren't picked, #257). There's no separate "Create channel" row under the list.
    - Under the title "Create" (만들기), a "Type" (종류) label (13px/600) holds two radio cards side by side: an 18px Lucide `hash` with "Chat channel" (채팅 채널) (14px/600) / "Members send messages to each other" (멤버가 메시지를 주고받아요) (12px secondary), and `messages-square` with "Forum" (포럼) / "Browse posts filtered by labels" (라벨로 거른 포스트를 모아 봐요). Cards have a 1px `{colors.hairline}` border, `{rounded.md}`, padding 10px 12px. The selected card has an accent border and an accent icon.
    - The dialog opens with the type of the category you pressed already selected, and focus goes to the name field. If you switch the type, the name you typed stays.
    - Chat channel: a name field and the help text "A chat channel everyone in the workspace can read and write in." (멤버 모두가 읽고 쓰는 채팅 채널이에요.) Forum: the fields of "Create forum" in "Conflict forum" below.
- **`app-nav-item`** The channel row. 30px tall, 2px between rows (32px pitch), padding 0 10px, `{rounded.sm}`. An 18px `#` icon and a 15px name, 8px apart.
  - On hover it's `{component.app-nav-item-hover}`, and the selected channel is `{component.app-nav-item-selected}` (6% background, name 600, only the icon in the accent color).
  - Channel rows have no invite or settings buttons. In stage 1 there are no per-channel members or settings. When they exist, add them as buttons that show on row hover.
- On narrow screens (833px and below), row and category header height go up to 44px.

#### Workspace and repos

A workspace is one GitHub account, and it holds several repos (ADR-0043). The screen is repo-first, like GitHub: the panel always belongs to one place (one repo, or the whole account), and you reach other places through the menu on the name row. @Pancheble picked this in 2026-11-19 draft 101 (#286, a polished 99-C). It replaces the earlier workspace picker (89-A) and the two-layer sidebar (90-A). The drafts that weren't picked (99-A, 99-B, 100-B, 100-C, and the rest of 89–94) are on the canvas under "Past drafts".

- **Name row** (draft 101-1): the button at the very top of the panel (`aria-haspopup="menu"`). About 44px tall, `{rounded.sm}`, padding 4px 6px 4px 4px.
  - On the left, a 28px account avatar, using the GitHub avatar. An organization is a `{rounded.sm}` square and a personal account is a circle (same as GitHub). If the avatar can't be fetched, use the first letter of the account name (12px/600 white text on `{colors.ink}`).
  - In the middle, two lines: the account name on top (12px secondary, ellipsis) and where you are now below (17px/600, ellipsis). Where you are now is a repo name or "All" (전체).
  - If another place has something new, an 8px accent dot shows, then a 14px Lucide `chevrons-up-down` (secondary text color) at the end. The background is `{colors.hover}` on hover and while open. The collapse button on the far right stays as it is.
  - It's a button even with one repo (Add repo lives inside it).
- **Repo picker menu** (drafts 101-1, 101-3): pressing the name row opens a `{component.app-popover}` (288px wide) right below it.
  - At the top, a "Find repo" (레포 찾기) field (14px Lucide `search`, 13px secondary, 1px `{colors.hairline}`, `{rounded.sm}`, padding 8px 10px). Typing filters the list below by repo name.
  - One collapsible group per account. The header (36px tall, 14px/600) has a 14px chevron, a 22px avatar, and the account name. When collapsed, it ends with "2 repos" (레포 2) (12px secondary) and an 8px accent dot if something new is inside. At first only the account you're viewing is open. The collapsed state is remembered per device.
  - Rows inside a group (32px or taller, indented 36px on the left, 14px): a 16px icon and a name. An account with two or more repos has "All of <account>" (<계정> 전체) (Lucide `layers`) at the top, then one row per repo (`book`). The current one is 600 with a 16px `check` (accent) at the end, and places with something new get an 8px accent dot. At the end of the group is "Add repo" (레포 넣기) (`plus`, 13px secondary). It shows only when you're an Admin of a repo in that account.
  - After a divider, a 12px secondary note: "Only repos you've added where you have push access show up." (넣은 레포 가운데 push 권한이 있는 것만 보여요.)
  - Picking a place takes you to the last channel you viewed there.
- **Panel for one place** (drafts 101-1, 101-2): no layer header or repo groups, just the "Chat channels" and "Forum channels" categories. A chat channel made with a category's `+` is created in the place you're viewing, and the forum's repo chip opens with the current place already selected.
  - Viewing a repo: that repo's chat channels and forums (forums filtered to just that repo).
  - Viewing "All of <account>" (draft 101-2): workspace channels, plus forums that look at all repos or at two or more repos (ADR-0043).
  - An account with only one repo has no "All", and workspace channels also show in that repo's panel. When a second repo comes in, workspace channels move to "All".
- **Adding and removing repos** (drafts 101-4 and the window in 91-A): visible only to that repo's GitHub Admins (ADR-0043). Repos in a personal account also only come in once added (2026-11-19 @Pancheble).
  - "Add repo" at the end of an account group in the menu opens the "Add repo" dialog (`{component.app-dialog}`, 560px wide). The description (13px secondary) reads "Only repos you're Admin of show up. Add personal repos too so Omagari can see them. Once added, people with push access to the repo join as members." (내가 Admin인 레포만 보여요. 개인 레포도 넣어야 Omagari가 봐요. 넣으면 그 레포에 push 권한이 있는 사람이 멤버로 들어와요.) Below it is the account you pressed (22px avatar and 13px/600 name).
  - Below that, a bordered list (1px `{colors.hairline}`, `{rounded.md}`) with one row per repo (48px tall, 16px `book`, a 14px/600 name and a 12px secondary "Private · 4 people with push access" (비공개 · push 권한 4명)). Repos not added yet end with an "Add" (넣기) button (bordered, small), and added repos end with "Added" (넣음) (12px secondary). Below that, a 12px secondary line: "For repos in other accounts, use \"Add repo\" under that account in the menu." (다른 계정의 레포는 메뉴에서 그 계정 아래 "레포 넣기"로 넣어요.) "Close" (닫기) sits at the bottom right.
  - Hovering a repo row in the menu (or reaching it by keyboard) shows a 28px ⋯ (Lucide `ellipsis`, "Repo menu" (레포 메뉴)) at the end. If you aren't an Admin, there's no ⋯. The menu is a `{component.app-popover}` (240px wide): "Open on GitHub" (GitHub에서 열기) (`external-link`), a divider, and "Remove from workspace" (워크스페이스에서 빼기) (`minus`, error color). Removing asks once more.
- **When you're the only member** (drafts 101-3 and 100-A. 100-B, where your work is the first screen, and 100-C, which draws personal accounts separately, weren't picked): decided by member count, not account type. The day someone gets push access on GitHub and joins, the items below go away.
  - There's no member list button in the header strip. The profile row has no presence dot or presence text.
  - In the forum list and the people row of a post, use your two conflicting branches instead of people (13px monospace, "feat/search ↔ fix/cache").
- **A repo you have no push access to** (draft 93-C. 93-A, which hides it and shows only the count, and 93-B, which shows a locked row, weren't picked. This keeps the names and counts of private repos from leaking to members without access): the panel leaves no trace. If you arrive at that repo's channel or post through a link, the conversation area shows `.empty`.
  - The header strip shows a Lucide `lock` and "Not found" (찾을 수 없음), with no description and no buttons. In the center are "You can't see this repo" (이 레포는 볼 수 없어요) (15px/600), "Only people with push access see this repo's channels and posts. Once you get access on GitHub, it shows up in your panel within 10 minutes." (push 권한이 있는 사람만 이 레포의 채널과 포스트를 봐요. GitHub에서 권한을 받으면 10분 안에 패널에 생겨요.) (13px secondary), and "Go to all of <account>" (<계정> 전체로 가기) (bordered button; for an account with just one repo, "Go to <that repo>" (<그 레포>로 가기)). The repo name isn't shown.

#### Collapsing the channel panel

On wide screens (834px and up), you can collapse the channel panel to widen the conversation area. When it's collapsed it's fully hidden, and you can peek at it from the window's left edge when you need it (like Notion's sidebar).

- **Collapse button**: a 28px button at the right end of the workspace name row. `{rounded.sm}`, an 18px Lucide `panel-left-close`, secondary text color, always visible. `{colors.hover}` on hover, and the tooltip is "Close channel panel ⌘\" (채널 패널 닫기 ⌘\). It's hidden in the drawer at 833px and below.
- **Collapsed look**: the whole panel, including the profile panel inside it, slides out, and the conversation area widens to 8px from the window's left edge. No icon strip is left behind.
  - A 32px expand button (`{component.app-header-button}`, Lucide `panel-left-open`) appears at the left end of the channel header strip (where the menu button goes on narrow screens). Its tooltip is "Open channel panel ⌘\" (채널 패널 열기 ⌘\), and pressing it expands the panel.
  - While the expand button is there, the header strip's left inner padding is 4px.
- **Peek**: while collapsed, holding the mouse on the expand button or on the window's left edge (8px of inner window margin) for 0.3 seconds shows the panel floating over the conversation (`{component.app-side-panel-peek}`).
  - It sits where the expanded panel would (8px from top, left, and bottom, 240px wide). The conversation area doesn't shift, and there's no backdrop behind it.
  - It slides in from the left in 240ms (the same `cubic-bezier(0.16, 1, 0.3, 1)` as the drawer).
  - It closes 0.3 seconds after the mouse leaves the panel, when you pick a channel, or on Esc. It stays open while a menu or dialog opened from the panel (the status menu, Create) is open.
  - On a peeked panel, the top-right button becomes Lucide `panel-left-open`, "Keep channel panel open" (채널 패널 펼쳐 두기). Pressing it goes back to the expanded state.
  - Just moving keyboard focus to the expand button doesn't peek. With the keyboard, press the button to expand.
- **Shortcut**: ⌘\ on Mac and Ctrl+\ elsewhere collapses and expands (same as Notion). It only listens at 834px and up.
- **Motion**: when collapsing and expanding, the panel column's width shrinks and grows in 240ms (`cubic-bezier(0.16, 1, 0.3, 1)`). With reduced motion, it changes right away, and so does the peek.
- **Focus**: collapsing with the collapse button moves focus to the expand button in the header strip, and expanding with the expand button moves focus to the panel's collapse button. A collapsed panel is out of focus and screen reading (`inert`). Both buttons carry `aria-expanded` and `aria-controls`.
- **Memory**: like category collapsing, the collapsed state is remembered per device. It starts expanded.
- At 833px and below there's no collapsing. The menu button on the left of the header strip opens the drawer as before. When the window gets wide again, it goes back to the remembered state.

#### Profile panel and status menu

- **`app-profile-panel`** At the very bottom of the channel panel. Background `{colors.selected}`, `{rounded.md}`, padding 4px. The whole panel is one button, and pressing it opens the status menu. There's no other button on the right (settings live in the status menu).
  - A 36px avatar (12px presence dot), a 15px/600 name, and below it a 12px secondary status message (emoji allowed, ellipsis if long).
- The **status menu** is a `{component.app-popover}` and opens right above the profile panel. From the top:
  1. A 40px avatar and the name ("Name (login)", see "Person avatar and name" below). The GitHub id is in the name row, so there's no separate line for it
  2. The status message field (36px tall, `{rounded.md}`, 1px border). A 28px emoji button on the left and a 24px clear button on the right. Status messages have no expiry time.
     - **The emoji is a single slot.** It's a value kept apart from the text, and the emoji button is that slot. Picking from the palette changes the slot. It doesn't attach to the text.
     - When it's empty, the emoji button shows an 18px smiley-plus icon (Lucide `smile-plus`, secondary text color).
     - The clear button clears the text and the emoji together. To clear only the emoji, use "Clear" (지우기) in the palette.
     - In the profile panel and the member list, the emoji goes before the text with one space. If there's only an emoji, only the emoji shows.
     - An emoji typed straight into the text field stays as text. We don't block it.
  3. A divider, "Online" (온라인)
  4. A divider, "Away" (자리 비움), "Do not disturb" (방해 금지) (description: you won't get notifications), "Appear offline" (오프라인으로 보이기) (description: you look offline to other people). Each of the three opens a duration menu from a chevron on the right: For 15 minutes, For 1 hour, For 8 hours, For 24 hours, For 3 days, Until I change it. The duration menu opens to the right as the same floating layer.
  5. A divider, "Settings" (설정), "Log out" (로그아웃) (`{colors.error}`). "Settings" opens the settings window (see "Settings window" below).
- **`app-menu-item`** 32px tall (40px with a description), `{rounded.sm}`, 14px. `{colors.hover}` on hover.

#### Emoji palette

It opens when you press the emoji button on the status message. The emoji button in the chat composer and the reaction button on a message open the same palette (see "Emoji in chat" below, 2026-11-19 @Pancheble, #291). Like Notion's palette, it holds every emoji, lets you search, and lets you jump between categories.

- **Frame**: the same floating layer as `{component.app-popover}` with zero inner padding. It opens to the right of the status menu (where it opens in chat is in "Emoji in chat"), and it's 474px wide. From the top: the search row, the emoji list, and the category bar. It closes on Esc or an outside press. Picking an emoji closes it.
- **Search row** (padding 10px 10px 8px):
  - Search field: 32px tall, `{rounded.sm}`, `{colors.selected}` background, a 14px magnifier in front, 14px text. The placeholder is "Find an emoji (e.g. smile, cat)" (이모지 찾기 (예: 웃음, 고양이)). Focus lands here when it opens.
  - Skin tone button: 32px, showing ✋ in the currently picked skin tone. Each press cycles through the default and five skin tones. The picked skin tone is remembered in that person's browser.
  - "Clear" (지우기): `{component.app-button-quiet}`, 32px tall. It clears only the emoji slot. It's there only when opened from the status message.
- **Emoji list**: 316px tall, scrolling inside the box (the scrollbar space is always reserved).
  - Each category has a title (12px/600 secondary text) and a 12-column grid. A cell is a 34px square, 2px apart, `{rounded.sm}`, with a 22px emoji. `{colors.hover}` on hover, and the currently picked emoji is `{colors.selected}`. Each cell shows its Korean name as an `aria-label` and a tooltip.
  - At the top is "Recent" (최근 사용) (the last 12 picked, remembered in that person's browser). Below it are nine Unicode categories: Smileys and emotion, People and body, Animals and nature, Food and drink, Travel and places, Activities, Objects, Symbols, Flags.
  - Emoji, Korean names, and search terms come from the Emojibase Korean data. There's no hand-picked list. Emoji that device can't draw are left out.
  - Searching matches against Korean names and search terms and hides "Recent". If nothing matches, the center shows "No emoji found" (찾는 이모지가 없어요) (13px secondary text).
- **Category bar**: below the list, above a 1px `{colors.divider}` line. Ten Lucide 18px icon buttons (36×32px, `{rounded.sm}`) for "Recent" and the nine categories, spread evenly. Pressing one scrolls to that category. The button for the category currently in view has a `{colors.selected}` background and body color, and the rest are secondary text color. Each button shows its category name as a tooltip.
- **Keyboard**: the down arrow in the search field enters the list, arrows move between cells, and Enter picks. The list is `role="grid"`.
- **Narrow screens** (833px and below): it opens as a sheet that slides up from the bottom over the status menu, and the column count fits the width. Cells are 44px.

#### Person avatar and name

2026-11-19 @Pancheble: "Let's take the Omagari profile picture and name from GitHub" (Omagari 프사랑 이름 github에서 가져오는걸로 하자) (#288).

- **Person avatar**: the GitHub profile picture as a circle. If there's no picture or it can't be fetched, use the first letter of the name on a `{colors.chip}` background (15px/600 at 40px). The agent mark (rounded square, executor abbreviation) stays as it is.
- **Person name**: written as "GitHub name (login)" ("Jane Doe (octocat)"). If there's no GitHub name or it matches the login, write just the login.
  - Where this form is used: message header, member list rows, profile panel, the head of the status menu, the top left of the settings window. The login is already in the name row, so there's no separate GitHub id line.
  - Names mixed into running text use just the GitHub name: agent names ("Jieun's Claude Code"), the people row and last post of a forum card ("Minsu:"), the decider chip, and the discussion seats.
- The name and picture are re-read from GitHub when you log in and when the server re-reads push access every 10 minutes. A change on GitHub shows up within 10 minutes.
- **Pressing opens the profile card** (see "Profile card" below): the avatar and name on a message, a row in the member list, the people row of a forum card, the decider chip, a discussion seat, and "Posted by Jieun Kim" (김지은이 올림) on a Q&A card. A person's name is a button (`aria-haspopup="dialog"`) and underlines on hover. Pressing your own name opens the same card (the place to change your status is still the profile panel).

#### Presence dot

- It sits at the bottom right of a person's avatar. On 36–40px avatars it's 12–13px, with a 2.5px ring in the background color around it.
- Shape tells them apart too: online is a green circle, away is an orange crescent, do not disturb is a red circle with a white horizontal bar, and offline is a gray empty ring.
- The dot on an agent mark (9px) shows whether the runner is connected. Connected is a green circle, otherwise an empty ring. It's separate from the person's presence.

#### Channel header strip

- **`app-channel-header`** 52px tall. On the left, `# channel name` (`{typography.app-title}` 20px/600) and "N members" (secondary text).
- **`app-header-button`** Two on the right: My agent and the member list. While the full profile view is open in the right column, the member list button looks pressed and its name becomes "Profile" ("Full profile view"). Normally only an 18px icon shows. Only a button whose right column is open gets `{component.app-header-button-pressed}` (6% background, accent icon) and gains its name (13px). When only the icon shows, the name is still read through `aria-label`.

#### Member list

- Group titles are "Online — 3" and "Offline — 1" (`{component.app-section-title}`). Away and do not disturb go under online.
- **`app-member-row`** The whole row is a button (`aria-haspopup="dialog"`), and pressing it opens that person's profile card to the left of the row (see "Profile card" below). Padding 6px 8px, `{rounded.md}`, `{colors.hover}` on hover, and the row with its card open is `{colors.selected}`. Rows don't expand. The work and agents that used to sit in the expanded row moved into the profile card and the full view (2026-11-19 @Pancheble, #291 drafts 103-B and 104-A).
  - A 40px person avatar (see "Person avatar and name" above) with a 13px presence dot.
  - First line: the name at 15px/600. If it's your row, "me" (나) (12px secondary) follows the name.
  - Second line (`{component.app-member-status}` 13px): the status message, then "· N works" (secondary text) next to it. If the message is long, only the message is cut and the work count always shows. If there's no status message, the presence (away, do not disturb, offline) goes there in secondary text, and if there's neither, just "N works". The work count counts only visible works: a work with no changes, no status line, and no claim is left out of both the profile and the count (#266). If there's no visible work, it says "No work" (작업 없음) (2026-11-19 @Pancheble, #268 draft 98-A). While that person's agent is answering a Q&A, "Answering" (답하는 중) goes before the work count (if there are several agents, "Codex answering" (Codex 답하는 중)) (PRD 17, 2026-11-18 @Pancheble, #257).
  - No chevron.
- A person who's offline gets a 50% faded avatar and a secondary-text-color name.

#### Profile card

A small card (`{component.app-profile-card}`) that pops up next to where you pressed a person (like Discord's profile card, 2026-11-19 @Pancheble, #291 draft 103-B). It shows "who this is and what they're doing now" on one sheet.

- **Frame**: the same floating layer as `{component.app-popover}`, 320px wide, zero inner padding (16px on the left and right of each section), 12px at the bottom. `role="dialog"`, with the name as `aria-label`. It closes on Esc or an outside press, and when it closes, focus goes back to where you pressed. Only one is open at a time.
- **Position**: on messages and in forums, it sits 8px to the right of the avatar or name you pressed, with the top edges lined up. In the member list, it's 8px to the left of the row. If it would overflow below the window, move it up so it fits inside.
- **From the top**:
  1. A 64px person avatar with an 18px presence dot (3px ring around it)
  2. The name (GitHub name, 17px/600), and below it the login (13px secondary) with a 12px Lucide `external-link`. The login is a link that opens `github.com/<login>` in a new tab. If there's no GitHub name, write the login on the name line and leave the link line as it is.
  3. Presence: an 8px dot and "Online" (12px secondary). The dot's shape is the same as "Presence dot".
  4. The status message (if any): `{colors.selected}` background, `{rounded.md}`, padding 8px 10px, 14px. The emoji goes before the text with one space.
  5. "N works" (12px/600 secondary heading) and the work rows. Each work has a 20px agent mark (an empty slot if unknown), a status line (13px), and below it the branch (`{component.app-source-ref}`), badges, and time written (12px secondary). Works are separated by a `{colors.divider}` line. Up to two show, and with three or more there's "N more works" (12px accent link, pressing opens the full view). If there's no visible work, this section isn't there. Which works get picked and what's written is the same as the member list's work count (ADR-0010, #266).
  6. "Full profile view" (프로필 전체 보기): `{component.app-button-outline}` full width. Pressing it closes the card and opens the full view in the right column.
- There's no agent row and no "Send message" field. There are no DMs between people (a DM is a conversation between you and your agent), and on the web you don't call someone else's agent (`@call`).
- For someone who's offline, add an "as of N hours ago" badge after the branch in a work row (same as the member list).

#### Full profile view

Pressing "Full profile view" on the card opens it in the right column (the member list and DM spot) (like Slack's "View profile", 2026-11-19 @Pancheble, #291 draft 104-A). You keep it open next to the chat.

- **Header** (48px tall): "Profile" (프로필) (17px/600), with a close button on the right. The person button in the channel header strip looks pressed (`{component.app-header-button-pressed}`) and its name becomes "Profile". Pressing that button or the close button closes the column.
- **The body** is one list (no tabs). From the top:
  1. An 80px person avatar with an 18px presence dot, the name (20px/600), the login link, and presence. The shape is the same as the card.
  2. The status message (same as the card)
  3. "N works" and every work. Each chunk is the same as a work row in the card. A work's agent is the executor that last sent a hook or `omagari status set` on that branch (ADR-0015). For a work we don't know (observation only), leave the mark spot empty and keep the same indent (#268 draft 97-A). We don't group works under agents (#268 draft 96-A).
  4. "N agents" and one row per agent of that person: a 20px agent mark, "Jieun's Claude Code", and a 12px status text on the right (the same wording as the agent menu in the DM column: "Idle" (쉬는 중) in secondary, "Answering…" (답하는 중…) in the accent color, and "Runner is off" (러너가 꺼져 있어요) if the runner is off) (2026-11-18 @Pancheble, #254).
- It scrolls inside the column. If the work and status of the person you're looking at change, they change in place.
- Pressing another person opens a card, and "Full profile view" on that card switches the person in the column.

#### Agent mark

- **`app-agent-mark`** A 20px rounded square (`{rounded.xs}`), background `{colors.surface-tile-1}`, with the executor abbreviation in white 11px/600: `CC` for Claude Code and `CX` for Codex. We don't use company logos.
- An agent's name includes both the person and the executor, like "Jieun's Claude Code" (ADR-0015).

#### DM column

- It opens in the right column. The "My agent" button in the channel header strip opens and closes it.
- The **header** (48px tall) shows the selected agent: a 20px agent mark, a 15px/600 name, and below it "Only you can see this · # channel" (나만 보여요 · # 채널) (12px secondary). A close button on the right.
- **You pick the agent to ask only from connected agents.** An agent whose runner is off doesn't show up as a choice. We don't put unusable buttons in.
  - With one connected agent, there's no picker. The header just shows that agent.
  - With two or more, the whole header becomes a button, with a 14px chevron beside the name (`aria-haspopup="menu"`). Pressing it opens a `{component.app-popover}` menu right below the header. Each row shows the agent mark, the name, and a status on the right ("Answering…" in the accent color, "Idle" in secondary text), and the selected row is `aria-checked`. No matter how many there are, it uses just the one header row.
  - With none, it shows an empty state instead of the composer: "No connected agents" (연결된 에이전트가 없어요) / "Turn on the runner on this device and you can ask here." (이 기기에서 러너를 켜면 여기서 물을 수 있어요.)
  - If the selected agent's runner disconnects, the selection switches to the first remaining connected agent. If none is left, it becomes the empty state.
- The Q&A list shows only the selected agent's. There's one channel session per channel and agent (ADR-0015), so switching agents switches to the Q&A with that agent. Q&As posted to the channel and `@call`s are Q&As of the same channel session, so they stay too, with a public badge. "Only you can see this" in the header speaks of the default visibility of Q&As you ask here, not the whole column.
- **Q&As are laid out like a conversation** (2026-11-12 draft 12-A). In a 300px column, we drop the card border and inner padding so the answer reads at the full column width. In the channel, Q&As stay as a collapsed line and a card (see "Q&A" below).
  - The **question** is a bubble stuck to the right (`{component.app-dm-question}`). White background, `{rounded.lg}`, padding 8px 12px, up to 80% of the list width. The time asked (12px secondary) goes at the bottom left of the bubble.
  - The **answer** (`{component.app-dm-answer}`) sits right below on the column background and uses the whole list width. Markdown follows "Markdown in agent answers", but inline code and code blocks switch to a `{colors.canvas}` background so they don't blend into the column's parchment.
  - One line below the answer holds the branch and commit it read (`{component.app-source-ref}`), the "Includes work-in-progress changes" (작업 중 변경 포함) badge, and the model badge for the model that answered. If it's narrow, the line wraps.
  - Below that, an action row (28px tall) holds "Post to channel" (채널에 올리기) (`{component.app-post-action}`: accent-color text, a 16px Lucide `forward` in front, `{colors.hover}` on hover). It's only on private Q&As that have an answer. What it does is in "Post to channel".
  - A public Q&A has, in place of the button in the action row, a 16px Lucide `check` and "Posted to # payments" (# 결제에 올렸어요) (posted) or "Asked in # payments with @call" (# 결제에서 @호출로 물었어요) (`@call`) in 12px secondary text, followed by a "View" (보기) link (accent color, underline on hover). "View" scrolls the channel to that Q&A line and briefly paints it with `{component.app-message-highlight}`.
  - While it's answering, "Answering" (see "Status" below) goes below the bubble, and for an answer that was cut off, an alert strip and "Ask again" (다시 묻기) go in the same spot.
  - Q&As don't each carry a "Private" badge. "Only you can see this" in the header already says so, and only public ones are set apart with the line above.
  - The gap between Q&As is 20px. The list stacks downward. When you open the column and when an answer arrives, if the last Q&A is longer than the list, scroll so the head of that question is at the top of the list (so you read from the question, not the end of the answer). If it's short, it sticks to the bottom.
- The composer's placeholder uses the selected agent's name, like "Ask Claude Code" (Claude Code에게 묻기).
- **Model and effort** are picked inside the composer, because that's a spot you see every time you send.
  - The DM column's `{component.app-composer}` becomes two lines. The top is the text. The bottom line has the model chip and the effort chip (`{component.app-composer-chip}`) on the left and the send button at the far right. Chips show the picked value with a 12px chevron, like "Opus ⌄" and "effort high ⌄". On narrow screens, the chips are 40px tall.
  - Pressing a chip opens a `{component.app-popover}` menu (`aria-haspopup="menu"`). Rows are `{component.app-menu-item}`, and the selected row has `aria-checked` and a `{colors.selected}` background. An open chip also has a `{colors.selected}` background.
  - **Menu position**: it opens above the composer (4px above the composer's top edge), not above the chip, so it doesn't cover what you're writing. The left edge lines up with the chip you pressed, but if the right edge would go past 8px inside the column, the right edge lines up there instead. It isn't cut off by the right column's edge. Its height is whatever's left from above the composer to below the DM header, and if it overflows, it scrolls inside the menu.
  - **When there are many models**: the executor reports every model back through past versions (Claude Code has 14). Of the same names once the version number at the end is dropped (Opus, Sonnet, Haiku…), only the one the executor listed first goes under "Default", and the rest fold into an "N earlier models" (이전 모델 N개) row at the bottom (a 14px chevron on the right, `aria-expanded`). Pressing it expands inside the same menu. If the selected model is an earlier one, it opens expanded. Names without a version number all stay at the top. (ChatGPT also keeps old models apart in its picker.)
  - The choices are only what the selected agent's executor reported through the runner. They differ by executor, and effort values differ by model. The top row is "Default" (기본) (secondary text on the right, "setting" (설정값)), which means it follows the executor's own setting as is. If the executor doesn't report effort, there's no effort chip.
  - The picked value is remembered per agent and used from that agent's next question. When you switch agents, the chips switch to that agent's values. `@call` has no chips of its own and asks with the value remembered for that agent.
  - An answered Q&A card carries a badge for which model answered (see "Badge" below).

#### Message

- **`app-message`** List style. A 36px avatar, a 15px/600 name and a 12px secondary time on one line, and below them the 15px/1.47 body. Padding 6px 20px 2px (only the bottom is 2px to tighten the gap with grouped lines, to match the implementation, #257), lines up to 720px.
- Messages the same person writes within 5 minutes of each other are grouped without a header. The time of a grouped line shows on the left on hover.
- The avatar and name are buttons, and pressing them opens the profile card (see "Profile card").
- Reaction pills (see "Reaction") attach below a message. A message that's only a GIPHY address shows as a picture (see "GIF").
- When the date changes, a 12px secondary text like "Today" (오늘) sits in the center with `{colors.divider}` lines on both sides.
- HTML and scripts in a message don't run and show as text.
- A message from a comment added on GitHub to a post's issue gets an `{component.app-badge-outline}` "GitHub" after the time in its header (ADR-0032). The writer is a GitHub login, so they may not be a member. The text isn't rendered as markdown and shows as plain text.

#### AI-written text

When you call an AI and say something, it's kept under the name of whoever called it, and the fact that an AI wrote it is always shown with it (2026-11-13 @Pancheble, ADR-0032).

- **App**: a Q&A line in a channel or post (`{component.app-qa-line}`) carries an `{component.app-badge-ai}` after the agent name, and an expanded card (`{component.app-qa-card}`) carries it before the public badge in its header. It's an `{component.app-badge-outline}` with a 12px Lucide `bot` and "AI", padding 0 6px, and on hover it says "AI-written answer" (AI가 쓴 답). We don't put it in DMs (a DM is always a conversation between you and your agent).
- **GitHub issue comments**: a Q&A posted to a post becomes a comment from the poster's account. It's marked with the text the poster wrote along with it, a blank line, and below that a GitHub alert quote.
  ```
  Pasting this for reference

  > [!NOTE]
  > 🤖 **AI-written answer** · Jieun Kim's Claude Code (Opus · effort high)
  > Question: Where's the partial refund amount calculated?

  (answer)
  ```
  If the model and effort aren't known, drop the parentheses. Text a person wrote carries no mark at all.

#### Q&A

- **A Q&A in a channel is the poster's message.** Posted Q&As and `@call`s both sit under a header with avatar, name, and time, like `{component.app-message}`. Under the header comes the text they wrote along with it (if any, "Post to channel"), and below that the collapsed line. With just the line, it would look like it belonged to whoever wrote the message right above. A Q&A message isn't grouped with the one before it and always carries a header.
- **`app-qa-line`** The collapsed single line of a Q&A in the channel. Parchment, `{rounded.pill}`, at least 36px tall, placed inside the message body. An agent mark, "Jieun's Claude Code" (600), the question (secondary text, ellipsis), and "Expand" (펼치기) on the right. If an `@call` is still answering, "Answering…" (accent color) takes the "Expand" spot, and the same line changes when the answer arrives.
- **`app-qa-card`** The expanded look. White background, 1px `{colors.hairline}`, `{rounded.lg}`, padding 16px.
  - Header: an agent mark, the name, "Posted by Jieun Kim · time" (김지은이 올림 · 시각), and a public badge on the right. In Korean, the particle follows the last letter of the name ("김지은이", "박민수가"). For a name that doesn't end in Hangul, write "owner posted" with no particle (owner 올림).
  - The question (15px/600) and the answer (`{typography.app-answer}` markdown)
  - Below a divider: "Code read" (본 코드), the branch and commit (`{component.app-source-ref}`), the "Includes work-in-progress changes" badge if there are work-in-progress changes, the model badge for the model that answered, and "Collapse" (접기) on the right
  - Cards in a channel have no "Ask again". For a cut-off `@call`, only an alert shows, and to ask again the owner `@call`s again from the composer.
- The dot on the agent mark in the collapsed line and the card is that agent's current state (whether its runner is connected).
- A Q&A inside a DM isn't a card but conversation-shaped (see "DM column"). A public one never goes back to private.

#### Input

- **`app-text-input`** 36px tall, `{rounded.md}`, 1px `{colors.hairline}`, 15px. A label (13px/600) above and help text (12px secondary) below.
  - While typing: only the border changes to `{colors.primary}`. There's no pale blue ring spreading outside (2026-11-13 @Pancheble). The message composer, search fields, and picker fields are the same.
  - Error: border `{colors.error}`, help text also `{colors.error}`, `aria-invalid`
- **`app-composer`** The message composer. White background, 1px line, `{rounded.lg}`, padding 6px 6px 6px 16px. It grows as lines are added up to 200px, then scrolls inside the box. A 32px round send button on the right (`{component.app-send-button}`). Enter sends, Shift+Enter breaks the line.
  - The composers in channels and posts have two 32px buttons in front of the send button: GIF (`{component.app-composer-gif}`, "GIF" at 11px/600 inside a rounded square with a 1.6px border) and emoji (a 20px Lucide `smile`). They're secondary text color, and on hover and while open they get a `{colors.selected}` background with body color. If the server has no GIPHY key, there's no GIF button (2026-11-19 @Pancheble, #291 draft 102-A, like Discord). The DM column's composer doesn't have them.
  - If the runner is off, it's `{component.app-composer-disabled}`: a parchment background with "Claude Code's runner is off, so you can't ask right now" (Claude Code 러너가 꺼져 있어 지금은 물을 수 없어요), and the send button is blocked.

#### Emoji in chat

2026-11-19 @Pancheble (#291): we add all of these: an emoji button in the composer, `:` autocomplete, and reactions. Slack and Discord have all three.

- **Emoji button**: pressing it opens the "Emoji palette" right above the composer (4px outside the line), with its right edge lined up with the button. Picking puts the emoji at the cursor, closes the palette, and moves focus back to the composer. An emoji is a character, so it goes into the message as is.
- **`:` autocomplete**: if you type `:` and two or more characters at the start or after a space (`:congrats`, `:th`), a `{component.app-popover}` list 300px wide opens above the composer with its left edge lined up. At the top is what you typed (12px/600 secondary), and below it up to five rows: an 18px emoji, a 14px Korean name, and the matched search term on the right (12px secondary). It picks from the names and search terms of the Emojibase Korean data and puts recently used ones first. It doesn't open for a time written with no space between `:` and the digits (`10:30`). The keyboard is the same as the `@call` menu (combobox, up and down, Enter or Tab, Esc, and Enter while composing doesn't pick). Picking turns the `:congrats` you typed into the emoji.

#### Reaction

- When you hover a message (or reach it by keyboard), an action strip shows at the message's top right: `{colors.canvas}` background, 1px line, `{rounded.sm}`, a shadow, padding 2px. A 28px "Add reaction" (반응 달기) button (a 16px Lucide `smile-plus`). Pressing it opens the emoji palette below the button, and picking adds the reaction.
- **Reaction pill** (`{component.app-reaction}`): 4px below the message body, 4px apart. 24px tall, `{rounded.pill}`, 1px `{colors.hairline}`, padding 0 8px. A 14px emoji and the count (12px/600). A reaction you added has an accent border, a 6% accent background, and an accent count (`aria-pressed="true"`). Pressing it adds or removes yours. Hovering shows the names of the people who added it as a tooltip ("Minsu Park and Seoyeon Lee reacted with 🎉"). At the end of the pill row there's a 28px "Add reaction" button of the same height (a 14px `smile-plus`).
- The emoji you can use are the whole palette. We don't fix it at eight like GitHub (same as Slack and Discord). Pills are in the order they were first added.
- Reactions are stored on the server and shared in real time (contract, ADR-0044). Reactions on a post's messages aren't carried over to GitHub issue comments.

#### GIF

We use only GIPHY (ADR-0044). The Tenor API shut down on 2026-06-30.

- **GIF box**: pressing the GIF button in the composer opens a floating layer 424px wide right above the composer (4px outside the line), with its right edge lined up (draft 102-A). From the top:
  - Search field: the same as the emoji palette's search field, with the placeholder "Search GIPHY" (GIPHY에서 찾기). Focus lands here when it opens. When it's empty, it shows GIPHY's popular GIFs. If you stop typing (0.4 seconds), it searches.
  - Results: a two-column staggered grid (300px tall, scrolling inside the box), 6px apart, `{rounded.sm}`. Each cell carries the title GIPHY gave as its `aria-label`. On hover, a 2px accent border. Keyboard is arrows and Enter.
  - Bottom row (above a 1px `{colors.divider}`, 12px secondary): "**Powered by GIPHY** · Your search goes to GIPHY" (찾는 말은 GIPHY로 가요). It's the attribution GIPHY's terms require and also a notice that the search term goes outside.
  - If nothing matches, "No GIFs found" (찾는 GIF가 없어요), and if GIPHY is blocked or over its limit, "Can't search GIFs right now" (지금은 GIF를 찾을 수 없어요) (13px secondary, centered).
- Picking sends right away. The message holds one line with the GIPHY address, and whatever you were writing in the composer stays as it was.
- **GIF in a message**: a message whose text is only one GIPHY address (`giphy.com/gifs/…`, `media*.giphy.com/media/…`) shows as a picture instead of the address. Up to 260px wide, the aspect ratio kept, `{rounded.md}`. A 11px/600 "GIF" strip at the bottom left (70% black background, white text). A pasted GIPHY address is the same. Other image addresses stay as links only (so the viewer's IP doesn't leak). The browser fetches the picture straight from GIPHY.
- For people who turned on reduced motion (`prefers-reduced-motion`), it shows a still first frame and plays when pressed.
- All ratings up to R show (2026-11-19 @Pancheble). There's no setting for it.

#### `@call` input

In a channel composer, you call your own agent and ask it so everyone sees from the start (issue #22). It reuses the DM column's picking rules, `{component.app-popover}`, and `{component.app-menu-item}` as they are.

- **Opening**: typing `@` at the start of the channel composer or after a space opens a menu 260px wide right above the composer with its left edge lined up. It doesn't open for an `@` in the middle of a word, like in an email address. It filters by what you type after `@` (`@co` → Codex), and closes if nothing matches.
- **Rows**: at the top, "Ask so everyone sees" (모두가 보게 묻기) (12px/600 secondary text) tells you it's public, unlike a DM. The rows below are the same as the DM column's agent menu: an agent mark, the name, and a status on the right ("Answering…" in the accent color, "Idle" in secondary text).
- **Choices**: only your own agents that are connected show. Even with one, you pick it from a one-row menu. You can't call someone else's agent.
- **When there are none**: the menu shows "No connected agents" / "Turn on the runner on this device and you can call your agent with @ and ask so everyone sees." (이 기기에서 러너를 켜면 @로 내 에이전트를 불러 모두가 보게 물을 수 있어요.) (`role="status"`).
- **Token** (`{component.app-call-token}`): picking removes the `@…` you typed and puts a token at the front of the composer. A parchment pill, 28px tall (40px on narrow screens), a 20px agent mark, a 13px/600 name, and a remove (×) button on the right. You call only one agent at a time. While there's a token, `@` doesn't reopen the menu, and Backspace with the cursor at the very start also removes the token.
- **Placeholder**: with a token, "Ask Claude Code so everyone sees" (Claude Code에게 모두가 보게 묻기). Without one, "Message # payments" (# 결제에 메시지 보내기).
- **Send failure**: the text and token go back into the composer and an alert strip shows. If the runner is off, "Claude Code's runner is off, so you can't ask right now" (Claude Code 러너가 꺼져 있어 지금은 물을 수 없어요), and otherwise "Couldn't send the question" (질문을 보내지 못했어요).
- **Keyboard**: the WAI-ARIA combobox (listbox) pattern. Focus stays on the composer (`aria-activedescendant`), up and down arrows pick, Enter or Tab inserts, and Esc closes. Enter while composing Hangul doesn't pick.

#### Post to channel

You attach a Q&A from the DM to the channel composer and send it along with your own words (2026-11-12 draft 13-C). The question and answer go up together (you can't post just the answer), and once posted it doesn't go back to private.

- **Attaching**: pressing "Post to channel" on a DM Q&A attaches that Q&A to that channel's composer, and focus goes to the composer's text line.
  - An `{component.app-qa-attachment}` stands on the composer's top line: a parchment pill, 36px tall (44px on narrow screens), a 20px agent mark, "Jieun's Claude Code" (13px/600), the question (13px secondary text, ellipsis), and a 28px remove (×) button on the right ("Remove Q&A to post" (올릴 문답 빼기)). You write the text on the line below it.
  - Only one Q&A attaches at a time. Pressing "Post to channel" on another Q&A replaces the attached one. Backspace with the cursor at the very start of the text also removes the attached Q&A.
  - It doesn't coexist with an `@call` token. Attaching a Q&A removes the token (the text you typed stays), and while a Q&A is attached, `@` doesn't open the menu.
  - The placeholder is "Add a word (optional)" (한마디 덧붙이기 (선택)). You can send just the Q&A with no text. While a Q&A is attached, the send button is on.
  - While it's attached, that Q&A in the DM shows a 16px Lucide `corner-down-left` and "Put in the channel composer" (채널 입력 칸에 넣었어요) (12px secondary) where the button was. Remove it and the button comes back.
  - The attached Q&A lives only in that channel, like the text in the composer. If you go to another channel, it drops off.
- **Narrow screens**: at widths where the right column floats over the conversation (1068px and below), pressing closes the right column (the DM screen at 833px and below) and goes to the channel composer.
- **Sending**: Enter or the send button. It goes up in the channel as one message from you: the header, the text you wrote, and the collapsed Q&A line (see "Q&A" above). The channel scrolls to that message, paints it with `{component.app-message-highlight}` (`{colors.selected}` background, `{rounded.md}`), and fades it out over 2 seconds. With reduced motion, it clears right after 2 seconds. The Q&A in the DM changes to "Posted to # payments · View" (# 결제에 올렸어요 · 보기).
- **Send failure**: the text and attached Q&A go back into the composer and the alert strip "Couldn't post to the channel" (채널에 올리지 못했어요) shows.

#### Conflict forum

Conflict is a forum channel (2026-11-13 draft 14-A, like a Discord forum, ADR-0027). Omagari turns each alert into one post, and people don't chat in the forum itself. They talk inside the post.

In stage 4 the forum stopped being a place that holds posts and became a view filtered by label (ADR-0039). At first there are "Discuss" (논의, what used to be "Conflict") and "FYI" (참고), and a post shows up in every forum it fits. On screen, the conditions that filter are called a "filter" (2026-11-17 @Pancheble, the word Slack and Notion use). Read the forum name "Conflict" below as "Discuss".

- **Channel panel** (2026-11-17 draft 55-D, the way Discord shows only the threads you've joined under a channel. We didn't pick 55-A, which hangs every open post under each forum, 55-B, which expands only the forum you pick, or 55-C, which drops the branch): under the "Forum channels" category there's one row per forum (18px Lucide `messages-square`).
  - The branch holds **only the open posts that involve me**: posts for alerts that touch my work, and posts where I wrote something. The decider is a member who spoke in the post, so posts I need to decide on land here too. If the same post fits several forums, it hangs under each of them.
  - A forum that has posts of mine gets a 20px chevron button at the end of the row (14px, secondary text color, `aria-expanded`, "Collapse/Expand my posts"). When collapsed, the count of my posts (12px secondary) and, if there's something new, an 8px dot stay in front of the chevron. The collapsed state is remembered per device. A forum with no posts of mine has no chevron.
  - Under the forums sits a 1px `{colors.divider}` line, then an "Other posts" row (18px Lucide `inbox`, secondary text color). It's where posts that fit no forum show up, and you can't edit or delete it.
  - The branch looks the same as before: indented 30px from the left, with one 1px `{colors.hairline}` vertical line running down from the conflict icon to the last post without a break. Only the last post bends like └, and middle posts get no horizontal branch (`│ │ └`, 2026-11-13 @Pancheble). 14px text, 600 weight plus an 8px dot on the right when there's something new. Resolved posts drop off the branch.
- **Header band**: 20px forum icon, the forum name (`{typography.app-title}`), "Omagari posts alerts as posts" (12px secondary). The only button on the right is the member list. A forum list has no channel session to ask, so there's no "My agent", and the DM becomes that post's once you open it (matches the implementation, 2026-11-18 @Pancheble, #257). The header band has no filter button (the header button in 52-B was dropped with 53-D).
- **Search field** (`{component.app-forum-search}`): 12px below the header band, as wide as the conversation field. 40px tall, an 18px magnifier in front, placeholder "Search posts (people, files, functions)" (포스트 찾기 (사람, 파일, 함수)). It searches labels too. Omagari creates the posts, so there's no "New post" button.
- **Tool row**: 10px below the search field.
  - First comes "Sort and view" (정렬과 보기, `{component.app-tag-chip}` with a 14px Lucide `arrow-up-down` and a 12px chevron). It opens a `{component.app-popover}` menu: "Sort" (Recent activity, Posted time) and "View" (List, Cards). The view you pick is remembered per device.
  - After a 1px vertical divider comes the **filter row** (2026-11-17 draft 53-D, like Notion's view filter. We didn't pick 53-A, which lists every label as a chip, 53-B, which gathers them under one filter button, or 53-C, which has a few chips plus "+ Label"). This row is that forum's filter, and it's the only filter.
    - One chip per condition (`{component.app-tag-chip}`, text color, `aria-haspopup="menu"`): the condition name in front (secondary text color), the value, and a 12px chevron. Written like "Status Open", "Label ●●● All labels that are Discuss + ● Payments". After them comes a "+ Filter" chip.
    - Pressing a chip opens a `{component.app-popover}` (300px wide) right below it. The label chip's window holds, from the top: a "Find a label" field, two group rows ("All labels whose importance is Discuss", "All labels whose importance is FYI", checkboxes, with 12px secondary text under the first row: "New labels and importance changes follow along"), a divider, one row per label (checkbox, 10px color dot, name), and at the bottom "Posts with at least one of the labels you turned on show up" (12px secondary). Turning a group on keeps those labels checked, locks them at 55% opacity, and adds "Discuss" or "FYI" at the end of the row.
    - Changing it updates the list on the spot. When it differs from the forum's saved filter, the changed chip's border turns the accent color, and at the right end of the row you get "Differs from the forum's filter" (12px secondary), "Reset" (outlined button), and "Save for everyone" (blue button, 26px tall). If you don't save, only you see it that way. If you save, it changes for every member.
    - At first, "Status Open" is on.
  - "Resolved" is a post whose alert cleared or whose issue someone closed on GitHub. When an alert clears, Omagari closes the issue.
- **List view** (default): one `{component.app-forum-post}` per post, 8px apart. `{colors.selected}` on hover.
  1. Verdict icon (16px, see "Verdict in the list" below), title 15px/600 (ellipsis), then the issue number "#44" (15px secondary text, `{component.app-issue-number}`)
  2. Kind badge (`{component.app-badge-warning}` for a direct conflict, `{component.app-badge-outline}` for anything else) on the line under the title; for an indirect conflict, the verdict badge follows it. Labels that aren't kinds come after that as `{component.app-label-badge}` (8px color dot and name, "Badge") (drafts 53-D, 54-C)
  3. One line with the last message (13px secondary, with the writer's name in front at 600 weight in text color, "Minsu:")
  4. People row (draft 27-B, 2026-11-13 @Pancheble): 22px avatars of the people involved, overlapping by 5px, then their names joined with " · " (12px text color, "Park Minsu · Me"). After that " · ", a 16px speech bubble icon with the message count, and "· 2 min ago" (12px secondary)
  - Branches, files, and line numbers don't go on the row. They're in the post's first message (the alert).
  - A resolved post is dimmed to 70% and gets a "Resolved" (풀렸어요) outline badge in front of the title.
- **Verdict in the list** (2026-11-13, drafts 29-B and 29-C combined): the merge run's verdict (ADR-0035) shows as two things, an icon in front of the title and a verdict badge. The icon is a 16px Lucide in secondary text color, and only "Fails" uses `{colors.warning}`. It gets `role="img"` and an `aria-label` with the verdict name. The verdict badge is text only.

  | Verdict             | Icon                                                             | Verdict badge                                  |
  | ------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
  | Guess (not run yet) | `circle-dashed`                                                  | "Guess" (추정) `{component.app-badge-outline}` |
  | Running             | `loader-circle` (one turn per second, stops with reduced motion) | "Running" (돌려 보는 중) outline badge         |
  | Fails               | `circle-x` in the warning color                                  | "Fails" (깨짐) `{component.app-badge-warning}` |
  | Can't tell          | `circle-question-mark`                                           | "Can't tell" (가릴 수 없음) outline badge      |
  | Passes (resolved)   | `circle-check`                                                   | "Passes" (통과) outline badge                  |
  | Direct conflict     | `circle-x` in the warning color                                  | None. The kind badge is the warning color      |
  - "Could not run" doesn't show separately in the list and stays as "Guess". The reason is in the post's verdict strip.
  - Duplicate work and contract changes aren't merge-run (ADR-0036), so they get no icon or verdict badge.
  - The tag gets "Confirmed". It's the label Omagari puts on the issue once a failure is confirmed.

- **Card view**: a 2-column grid, 12px apart. `{component.app-forum-card}` holds the three rows of the list view. In stage 2 there's no preview of the conflicting lines at the top (2026-11-13 @Pancheble, the reason and the spec are in Known Gaps).
- **Titles** don't contain people. People show up separately in the people row (draft 27-B). The title is the issue title with its number ("refund's reason field #44") (ADR-0032). For an issue Omagari opened, the title is the conflicting file (or symbol) and the kind ("refund.ts direct conflict"), and it follows along if someone changes it on GitHub. If the issue isn't open yet, the title is just the conflicting file (or symbol), with no number.

- **Create a forum** (2026-11-17 draft 52. We didn't pick 52-A and 52-C, which put a forum item in the settings window. The settings window has no forum item): the `+` on "Forum channels" in the channel panel opens the "Create" dialog (`{component.app-dialog}`, 560px wide) with "Forum" already picked ("Channel panel"). You set the filter when you create it, and edit it afterward in the forum's filter row.
  - From the top: the title "Create" and the kind picker, a description (13px secondary, "A forum is a view filtered by label. You can still edit the filter in the forum's filter row after you create it."), the name field, groups (the same two checkbox rows as the label chip's window above), labels (`{component.app-tag-chip}` with a color dot, `{component.app-tag-chip-on}` when on, locked when turned on by a group), and "Posts with at least one of the labels you turned on show up. 14 show up right now." (12px secondary).
  - Under that, a `{colors.selected}` box, "Here's how it looks", with three matching post titles and "and N more". "Cancel" and "Create" at the bottom right.
  - There's no place to delete a forum yet (Known Gaps).
  - **Filter by repo** (2026-11-18 draft 92-A, #231. We didn't pick 92-B, which first asks "All repos / one repo / several repos", or 92-C, where the `+` you pressed decides the repo): under the name field, a "Repos" (레포) row (13px/600) and a row of chips. First an "All repos" chip, then one chip per repo (`{component.app-tag-chip}`, with `{component.app-tag-chip-on}` and a 14px `check` when on). Turning on "All repos" also covers repos added later, and the repo chips turn off.
    - It opens with "All repos" on.
    - Under the chips, a `{colors.selected}` band (12px secondary, 14px `info`) tells you where this forum will show in the panel: "One repo, so it shows under space.", "Two repos, so it shows across omagari-dev." (ADR-0043)
    - After you create it, a "Repo" chip ("Repo space, billing", "Repo all") is added to the forum's filter row after the status chip. If you change it like any other chip, "Differs from the forum's filter" shows up, and saving for everyone can move the forum to a different level of the panel.

#### Post

- **Open in the side pane** (default, draft 14-A. We didn't pick 14-B, which opens it right in the middle, or 14-C, where cards are the default): pressing a list row or card turns the right pane into `{component.app-post-panel}` (480px), and the forum list stays in the middle. The row you picked gets a `{colors.selected}` background and a 1px `{colors.hairline}` inner line. It uses the right pane's spot, so the header band buttons shrink to icons without names.
  - Header (52px): title 17px/600 (ellipsis), then the issue number "#44" (15px secondary text, a link to the GitHub issue, new tab, accent-color underline on hover), and on the right a 32px "Label" (Lucide `tag`), "Expand" (크게 보기, Lucide `maximize-2`), and close (×).
  - Under that is the conversation, and at the bottom `{component.app-composer}` (placeholder "Send a message to this post").
- **Expanded view**: the post becomes the middle conversation pane, and the right pane goes back to the DM or the member list. The header band has "‹" (back to the forum), "Conflict ›" (13px secondary), the title (`{typography.app-title}`) with the issue number link (17px secondary), and on the right "To side pane" (Lucide `minimize-2`), my agent, and the member list. The input placeholder is "Send a message about refund.ts".
- **The first message is Omagari's alert.** It looks like `{component.app-message}`, with `{component.app-omagari-mark}` in place of the avatar (36px, a rounded square on `{colors.ink}`, a white 18px Lucide `git-merge`), the name "Omagari", and a body of `{component.app-alert-card}`: a kind badge, the two people and branches (12px monospace secondary), and on the next line the file and line range (12px monospace secondary). When the alert is updated, this message changes and "Edited at 10:38" is added next to the time.
- **Add and remove labels** (2026-11-17 draft 54-C. We didn't pick 54-A, which puts a label row under the header, or 54-B, which edits inside the alert card): the "Label" button in the header (`{component.app-header-button}`, `{component.app-header-button-pressed}` when open) opens a `{component.app-popover}` (260px wide) right below it. It has a "Find a label" field, one row per label (checkbox, 10px color dot, name, and 12px secondary "Discuss" or "FYI" at the end of the row), and at the bottom "Labels on issue #43 change too. If any label is Discuss, this post is Discuss." (12px secondary). Checking a box adds or removes it right away.
  - Attached labels show as `{component.app-label-badge}` after the kind badge in the alert card, and if the post's importance is Discuss, "Discuss" (`{component.app-importance-discuss}`) follows. The same label badges show on the post cards in the forum list.
- **Badge on the first message**: when a merge run confirms an indirect conflict, the alert card's badge changes from "Indirect conflict · guess" (`{component.app-badge-outline}`) to "Indirect conflict · confirmed" (`{component.app-badge-warning}`). If it passes and closes, "Resolved" is added after "Indirect conflict · guess".
- **Debate strip** (`{component.app-debate-strip}`) always sits above the conversation once a debate opens (see "Debate" below). When the verdict strip and the decision status strip are also there, the order from the top is the debate strip, the verdict strip, and the decision status strip. If a debate has never opened, there's no strip.
- **Open a debate** (2026-11-17 draft 60-B. We didn't pick 60-A, which pops up a small window, or 60-C, which opens it from a card under the alert): a post with no evidence label and no debate ever opened has "Open a debate" (토론 열기) in its header (`{component.app-header-button}`, 18px Lucide `messages-square`, the 13px name always visible, in front of "Wrap up the decision"). If a debate is open, it becomes "View debate". Pressing it opens a `{component.app-dialog}` (520px wide) (see "Debate" below).
- **Verdict strip** (`{component.app-verdict-strip}`) always sits above the conversation while a merge run is running (see "Verdict strip" below).
- **Decision status strip** (`{component.app-decision-strip}`) always sits above the conversation once a decision PR opens (see "Decision status strip" below). If there's a verdict strip, it goes under that one. All three strips stay fixed under the post header, outside the scrolling conversation, and messages stack below them (above the conversation, not under the first message, to match the implementation, 2026-11-18 @Pancheble, #257).
- **DM**: the second line of a DM pane header opened from a post reads "Only you can see this · refund.ts". "Post to channel" under an answer becomes "Post to this post", and after you post it, it says "Posted to this post · View". The rest is the same as "DM pane" (including the model and effort chips).
- **Sidebar mark**: on a work row with a direct conflict, a "Direct conflict" `{component.app-badge-warning}` goes after the work line and comes off when it resolves. On a work whose merge run verdict is "Fails", the same spot gets a "Breaks when merged" `{component.app-badge-warning}`.

#### Verdict strip

The merge run's verdict (ADR-0035) always shows as a one-line strip above the post's conversation (2026-11-13 draft 28-B). We didn't pick 28-A, which puts it inside the alert card, or 28-C, which stacks one line at a time in the conversation. The strip looks like the decision status strip.

- **`app-verdict-strip`** min height 44px, `{rounded.md}`, 13px, `role="status"`. On the left, a 16px verdict icon, the verdict name (600), and a description (secondary text). It wraps when narrow. It's only on indirect-conflict posts, and if no runner has posted a verdict, there's no strip.
- **Verdicts**: icon · name · description · strip color
  - `loader-circle` · Running · "npm test on Jieun's machine · 20s so far" · default
  - `circle-x` · Fails · "Breaks when merged · both pass on their own" · `{component.app-verdict-strip-warning}`
  - `circle-check` · Passes · "Passes when merged, so I closed the post · npm test · just now" · default
  - `circle-question-mark` · Can't tell · "It breaks even with only Minsu's work" · default
  - `circle-minus` · Could not run · give the reason: "The repo has no check command · How to set one", "Jieun's machine has no sandbox tool · How to install", "Cut off after 5 minutes · doesn't count as a pass", "Resolve the direct conflict first to run this" · default. "How to set one" and "How to install" are accent-color links.
  - Stale result: if the content changed after the run, " · Stale result" goes after the name, the description is "The content changed, so it runs again once things settle down", and the strip color is default.
- **Output**: for a failure, the right end has "View output" (`{component.app-button-quiet}`, 28px tall, `aria-expanded`). **Output is collapsed by default** (2026-11-13 @Pancheble). Pressing it opens one line 6px under the strip (12px monospace secondary text, "npm test · 48s · Jieun's machine · 2 min ago") and the output box, and the button becomes "Collapse output".
  - **`app-verdict-output`** white background, 1px `{colors.hairline}`, `{rounded.sm}`, 10px 12px padding, 12px monospace, line height 1.55. It scrolls sideways without wrapping. Only the end of the output shows.
  - A verdict that didn't post its output (a runner whose share level isn't full) has no "View output".
- **Color**: the warning color is only for failures. Passes don't get green (there's one accent color).
- **When there are two strips**: if a decision PR is open, the verdict strip is on top and the decision status strip is below. Strips are 6px apart, and in the side pane the panel's 16px inner spacing adds up to 22px (the expanded view stays at 6px. 2026-11-16 @Pancheble #139 review, 2026-11-18 #257).

#### Wrap up the decision

My agent reads the post and writes a draft, then a person reads and edits it and opens the decision PR (2026-11-13 @Pancheble, ADR-0028). Agents debating to settle things is stage 4.

- **Getting in**: "Wrap up the decision" (결정 정리하기) in the post's header band (`{component.app-header-button}`, 18px Lucide `pen-line`, the 13px name always visible). Pressing it opens a `{component.app-dialog}` 560px wide and 776px tall and starts writing the draft right away.
- **Draft band** (`{component.app-draft-band}`): under the dialog title. A 20px agent mark, a 13px/600 title, a 13px secondary description, `role="status"`.
  - Writing: "Jieun's Claude Code is writing a draft" / "Reading 6 messages and 1 Q&A in this post". On the right, "Stop writing" (`{component.app-button-quiet}`, 28px tall). The four fields are `{component.app-skeleton}` bars (14px tall, 1–3 lines per field), and the form gets `aria-busy`. Unless reduced motion is on, they fade out and back over 1.4 seconds.
  - Done: "A draft written by Jieun's Claude Code" / "Written after reading 6 messages and 1 Q&A in the post. Read it and edit it before you open it." On the right, the badge of the model that answered. The model and effort that write the draft are the values remembered in the DM.
  - Runner off: `{colors.warning-bg}` background, `{colors.warning}` text, "Can't write a draft" / "The Claude Code runner is off. Write it yourself, or turn the runner on and ask for a new draft." The fields are empty and the hint shows.
  - If you stopped it: "Stopped writing the draft" / "Write it yourself or ask for a new draft."
- **Fields**: 2 columns. Title (one line, spans both columns), context and decision (4 lines each, side by side), consequences (2 lines, spans both columns). The input looks like `{component.app-text-input}` at 14px. Placeholders are "What did you decide?", "Why did it need deciding?", "What did you decide on?", "So what changes?".
- **Objection window** (ADR-0030): segmented buttons "Now", "1 hour", "1 day" (default), "3 days", "Custom". Picking "Custom" puts a number field (72px wide, 32px tall, default 12), a unit picker (hours, days), and "for" on one line below it. Under that, a description (12px secondary):
  - Now: "It merges as soon as you open it. There's no time to object, so only pick things that are easy to undo."
  - Others: use the length you picked, like "It merges if nobody objects for a day. If all deciders agree, it merges sooner."
- **Filled in automatically**: a `{colors.selected}` box with the deciders (the avatars and names of members who spoke in this post) and the source (a link to this post, accent color).
- **Bottom**: a right-aligned line, "Opens a decision PR on Pancheble/omagari as Jieun." (12px secondary). Under it, on the left "Ask for a new draft" (if there's no draft, "Ask for a draft"), and on the right "Cancel" and "Open decision PR". "Open decision PR" only turns on once the draft is finished or a person has filled in the fields.

#### Decision status strip

The decision PR's status always shows as a one-line strip above the post's conversation (2026-11-13 draft 15-A). The same line doesn't show in the forum list.

- **`app-decision-strip`** min height 44px, `{rounded.md}`, 13px, `role="status"`. On the left, a 16px Lucide `git-pull-request`, the status name (600), a description (secondary text) and a "PR #12" link (accent color), and a button at the right end (28px tall, 13px). It wraps when narrow.
- **Statuses**: name · description · strip color
  - Proposed · "18 hours left · 1/2 agreed · It merges right away if all deciders agree" · default
  - N objections · "Minsu objected · It won't merge until all objections are withdrawn" · `{component.app-decision-strip-warning}`
  - Reopened · "All objections were withdrawn, so the window reopened · 24 hours left · 1/2 agreed" · default
  - Merge blocked · "The window closed, but GitHub blocked it: it needs an approving review from someone other than Jieun · It merges as soon as that's cleared" (a failed check or a conflict gets its reason in the same spot) · warning
  - Merge paused · "Jieun's GitHub token stopped working, so the merge is paused · It continues once Jieun signs in again" · `{component.app-decision-strip-error}`
  - Accepted · "Merged as docs/decisions/0003-calc-refund-signature.md" (if everyone agreed and it merged early, "All deciders agreed, so the window closed early and …") · default
  - Dropped · "Jieun dropped the decision and closed the decision PR" · no background, secondary text
- **Buttons**: they depend on who's looking.
  - A decider who isn't the person who wrapped it up: "Agree" (`{component.app-button}`) and "Object" (`{component.app-button-outline}`). The person who wrapped it up has already agreed by opening it. If all deciders agree, the window closes early and it merges right away (ADR-0029).
  - A member who isn't a decider: only "Object".
  - The person who objected: "Withdraw my objection" (`{component.app-button-outline}`).
  - The person who wrapped it up: "Edit and repost" (`{component.app-button-quiet}`) and "Drop" (`{component.app-button-danger}`). After it merges or is dropped, there are no buttons.
- **A line in the conversation**: each time the decision PR opens, someone agrees, objects, or withdraws, and it merges or closes, an Omagari line stacks up in the post: a 16px icon, "Omagari · Jieun opened decision PR #12 · objection window 1 day · 10:50 AM" (13px secondary, padding 4px 20px 4px 24px).

#### Debate

On a post with an evidence label ("Confirmed", "Contract change"), the owner agents of the two conflicting works go through a debate that ends in this order: hidden first stances, rebuttal rounds, experiments, verified evidence, then people (ADR-0040). @Pancheble picked the drafts on boards 56–60 on 2026-11-17. The ones we didn't pick are in "Past options".

- **Inside the post**: the debate happens in the post's conversation. From the top, the debate strip, verdict strip, and decision status strip attach, and the alert and stance cards stack in the conversation. People can still speak in the conversation as usual.
- **Stance card** (2026-11-17 draft 56-C. We didn't pick 56-A, which stacks stances one after another in the conversation, or 56-B, which puts both options side by side on one card): one `{component.app-debate-card}` per option, stacked in the order Option 1, Option 2. The name of whoever gave the stance stays covered until there's a conclusion (see "Hiding while picking" below).
  - **Header**: a 28px number circle (`{colors.chip}`), "Option 1" (14px/600), `{component.app-badge-ai}` ("Written by AI", AI가 쓴 글), the badge of the model and effort that answered (`{component.app-badge-outline}`), an outline badge "Joined without context" if it joined with no context, and a "Round 2" outline badge at the end of the row. It wraps when narrow.
  - **Body**: the claim (14px, line height 1.5), a change line if the stance changed, the list of evidence, then the experiment line, in that order. Stances from earlier rounds are folded at the bottom of the card behind "Show round 1 stance" (13px secondary, 1px `{colors.divider}` on top, `aria-expanded`), and opening it shows that round's claim, evidence, and experiment in a dotted-border inner box on `{colors.canvas-parchment}`. Earlier rounds go in round order.
  - **Change line**: `{colors.selected}` background, `{rounded.sm}`, 13px, padding 6px 8px. If a reason is given: a 16px Lucide `refresh-cw`, "Changed stance" (600), and " · Reason: …". If it changed with no reason: `{colors.warning-bg}` background, Lucide `triangle-alert`, "Changed with no reason" (600), and "It's different from the last round, but no reason was written". If it didn't change, there's no line.
  - **Evidence list**: each row has an evidence mark in front, then the agent's text as written (13px, references in 12px monospace). The mark is a 20px-tall badge. Verified is a 12px Lucide `check` with `{component.app-badge-outline}` (text color), unverified is `circle-dashed` with `{component.app-badge-outline}` (secondary text color), and doesn't exist is `circle-x` with `{component.app-badge-warning}`. The mark column is fixed at 104px.
  - **Experiment line**: a 12px Lucide `flask-conical` and "Experiment" (600), the verdict icon and name, a description (the check command it ran and how long it took), and "View patch" at the right end (accent color). A pass has a 1px `{colors.hairline}` border, a failure has a `{colors.warning-bg}` background with `{colors.warning}` text and "View output" at the right end. If it couldn't run: `circle-minus`, "Could not run", and the reason ("The repo has no check command"). The verdict names and icons are the same as the verdict strip's.
  - **When a slot is empty**: a slot with no option is drawn as `{component.app-debate-card-ghost}` (dotted). "One stance · given" (`eye-off`, kept hidden until both are in), "One stance · waiting" (`hourglass`), "One option slot · debate participation is off" (`power`), and "Couldn't give a stance" (`circle-x`, one line with the reason). During the first round we don't know whether a given stance will be Option 1 or Option 2, so there's no option number.
- **Debate strip** (2026-11-17 draft 57-A. We didn't pick 57-B, a two-line strip where the steps are always visible, or 57-C, a collapsible strip): `{component.app-debate-strip}` min height 44px, `{rounded.md}`, 13px, `role="status"`, the same look as the verdict strip. On the left, a 16px icon, "Debate · round 2/3" (600), three round dots (8px, past rounds filled with `{colors.ink}`, the current round white with a 2px `{colors.ink}` border, remaining rounds a gray darker than `{colors.hairline}`), and a description (secondary text). There can be a button (28px tall) at the right end. It sits 8px from the verdict strip below it (the 22px rule between the decision status strip and the verdict strip is unchanged).
  - State · icon · name · description · right button
    - `eye-off` · "Round 1/3" · "Hidden first stances · stance 1/2"
    - `messages-square` · "Round 2/3" · "Rebuttal · stance 1/2"
    - `flask-conical` · "Round 2/3" · "Running an experiment · npm test · 20s so far"
    - `hourglass` · "Waiting" · "Park Minsu's agent isn't here yet · 13 days left" · "Call a stand-in"
    - `gavel` · "Time to pick" · "Pick one of the two options · the owners are covered"
    - `check` · "Went with Option 1" · "Jieun picked it · you can write the decision draft" (if no one picked and an experiment or evidence settled it, "Only one option passed the experiment" or "Verified evidence is only on Option 2 · no one has to pick") · "Wrap up the decision" (`{component.app-button}`)
    - `circle-minus` · "The debate ended" · "No stance came in after 14 days" (no background, secondary text)
  - The waiting name is only used in the first round. The first round is still covered, so the name doesn't give away the option number. In later rounds it's just "stance 1/2" with no name (the option's owner can be seen by pressing the cover, but the strip doesn't say it first).
- **Picking** (2026-11-17 draft 58-C. We didn't pick 58-A, which puts "Pick Option 1" and "Pick Option 2" on the strip, or 58-B, which puts a decide button on each card): at the time to pick (`state` is `choosing`), a `{component.app-debate-card}` stands at the bottom of the conversation. Every member of the post sees this card.
  - At the top, a 16px Lucide `gavel` and "Pick one" (600). One radio card per option (1px `{colors.hairline}`, an accent-color line when picked, `{rounded.md}`, padding 10px 12px): a radio, "Option 1" (14px/600), one line with the claim, and under that 12px secondary "2 verified evidence · experiment passed". Nothing is picked at first.
  - Under that, 12px secondary "You can't change this once you pick. The option picked first becomes the decision draft, and objections can be raised in the decision PR's objection window." At the bottom right, "Go with Option 1" (`{component.app-button}`). The button is off until you pick (`{component.app-button-disabled}`).
  - **After picking**: this card turns into the conclusion card. A 16px `check`, "Went with Option 1" (600), "Jieun picked it · 3:12 PM" (13px secondary), a description (13px secondary) "Option 1 came from Choi Hajun's Claude Code (feat/mail-queue) and Option 2 from Park Minsu's Codex (fix/webhook-retry). Jieun's Claude Code writes the decision draft based on Option 1.", and "Wrap up the decision" at the bottom right. The header of the chosen option's card gets "Chosen" (`{component.app-badge}`, white text on `{colors.ink}`) and the agent that gave it ("Choi Hajun's Claude Code" outline badge, branch in 12px monospace secondary), and the option that wasn't picked gets the same owner mark. The strip has no "Wrap up the decision", so only one blue button is left on the screen.
  - Wrapping up the decision is the same as the current one (see "Wrap up the decision" above), and the draft is written from the chosen option's stance and evidence (ADR-0028, ADR-0040).
  - A debate settled by an experiment or by evidence has no picking card, and only the strip changes to "Went with Option 1 · Only one option passed the experiment". The owners are revealed at that point too. For a debate with a stand-in, the strip's description is "A stand-in is in this debate · the objection window stays open until the owner comes back and checks".
- **Waiting and calling a stand-in** (2026-11-17 draft 59-C. We didn't pick 59-A, which calls one right from a strip button, or 59-B, which expands from the empty slot card): while waiting for an owner whose runner is off, the debate strip always has "Call a stand-in" (`{component.app-button-outline}`, 28px tall). Any member of the post can press it, anytime while waiting.
  - Pressing it opens a `{component.app-dialog}` (400px wide). The title is "Call Park Minsu's stand-in?", and the list (14px, line height 1.5) reads: "My runner starts it on my usage", "It only sees Park Minsu's draft PR, branch diff, and related decisions (the work conversation is on Park Minsu's machine, so it can't see it)", "A stance the stand-in gives is marked "Stand-in"", "When Park Minsu's agent comes back, it takes over. For a decision with a stand-in, the objection window stays open until Park Minsu checks". "Cancel" and "Call a stand-in" (`{component.app-button}`) at the bottom right.
  - After calling, an Omagari line stacks up in the conversation: a 16px `bot`, "Jieun called Park Minsu's stand-in · Jieun's runner started it on Jieun's usage · 3:05 PM" (13px secondary, only the name in 600 weight in text color).
  - **Hiding while picking works like a spoiler** (2026-11-17 draft 61. @Pancheble changed draft 59's (b) "reveal after picking": "just go with that spoiler feel, it's not that you can never see it, you see it if you want to, like a Discord spoiler where it's just hidden from view"): while picking, the option's owner (name, branch) and the "Stand-in" mark are covered so they don't show at a glance, and whoever wants to see them presses it. It doesn't block anyone from seeing. For an option with a stand-in, the same single chip covers both the owner and the stand-in.
    - **Covered look** (`{component.app-spoiler}`): in the card header, one chip after "Written by AI" and the model badge. 20px tall, always 136px wide (so the text length doesn't leak the owner), `{rounded.pill}`, `{colors.dark-chip}` background, and a 12px Lucide `eye-off` in the center (`{colors.dark-text-secondary}`). It has no text. There's one per option number, and an option with no stand-in gets the same chip (so whether there's a stand-in doesn't leak through the chip's shape).
    - **Hover and keyboard**: on hover the background gets a little lighter (`#4a4a4d`). When reached by keyboard, a 2px `{colors.primary}` ring is drawn 2px outside. The chip is a `button` with `aria-pressed="false"`, and its name is "Show Option 1's owner. Only shows on this screen when you press it". You reach it with Tab and open it with Enter or Space. While covered, a screen reader reads neither the owner nor whether there's a stand-in.
    - **After pressing**: the chip turns into text in the same spot. An outline badge "Choi Hajun's Claude Code" (text color) and 12px monospace secondary "feat/mail-queue", and if a stand-in gave the option, a "Stand-in" outline badge (12px Lucide `bot`) goes between them and its name is "The agent Jieun started on Park Minsu's behalf". The changed text is `role="status"`, so a screen reader reads it like "Choi Hajun's Claude Code, feat/mail-queue". It opens only on the screen of whoever pressed it and doesn't cover again (same as a Discord spoiler). Refreshing covers it again.
    - **After picking**: both options' chips open for everyone, on every screen. The conclusion card and the chosen option's header mark are the same as "Picking" above.
    - The cover is only a screen mask. Once the stances are revealed, the server right away posts them as GitHub issue comments under the owner's account (Q&A A21, ADR-0032, #216). In those comments too, a stand-in's stance gets the "Stand-in" mark. So on GitHub it's visible from the start, and what this cover handles is the Omagari screen.
- **Open a debate** (2026-11-17 draft 60-B): pressing "Open a debate" in the header opens a `{component.app-dialog}` (520px wide). From the top: the title "Open a debate", a 13px secondary description "retry.ts duplicate work #43 · The agents of the two conflicting works give stances on the topic.", an "Agenda" field (`{component.app-text-input}`, one line, placeholder "Write in one line what you're conflicting over"), an "Evidence" field (multiple lines, min height 84px, placeholder "Paste commits, file:line, and decision files and they get verified"), under that 12px secondary "If the agenda or evidence is empty, the debate won't open and only the request stays in the post.", under that 12px secondary "Once opened, the agents of the two conflicting owners give stances on their own usage. There are up to 3 rounds.", and "Cancel" and "Open a debate" (`{component.app-button}`, only on when neither the agenda nor the evidence is empty) at the bottom right.
  - **After it opens**: the debate strip (round 1/3, hidden first stances · stance 0/2) attaches, and a "Debate request" card stacks up in the conversation (`{component.app-debate-card}`: a 16px `messages-square`, "Debate request" (600), "Jieun · 3:01 PM" (12px secondary), and "Agenda" and "Evidence" with 12px/600 secondary names over 13px text).
  - **When it couldn't open** (an agent sent the agenda or evidence empty through the CLI): the same card has a `{colors.warning-bg}` background and the title "Debate request · didn't open", empty fields read "(Empty)", and under it, in `{colors.warning}` text, "The evidence was empty, so the debate didn't open. Add evidence and request again." At the bottom right is "Add evidence and request again" (`{component.app-button-outline}`).
  - If a debate is already open, the header button says "View debate" and pressing it goes to the debate strip.

#### Settings window

A window opened from "Settings" in the status menu (2026-11-13 draft 16-B, like macOS System Settings). We add items when we need them.

- **`app-settings-window`** 980×676px (widened from 820×580px for the label item's two columns, 2026-11-17), `{rounded.lg}`, a back cover of `{colors.overlay}`, `role="dialog"` and `aria-modal`. It closes with Esc, pressing the cover, or the 32px close button (×) at the top right.
- **Left list** (220px, parchment, 1px line on the right, 16px 10px padding): at the very top, my 36px avatar and name ("Name (login)", with no separate GitHub ID line). Under that, group titles (12px/600 secondary) and `{component.app-settings-item}` rows (36px tall, an 18px icon and a 15px name, `{colors.hover}` on hover, the picked row gets `{colors.selected}` and 600 weight, `aria-current`).
  - "Me": My agent
  - "Workspace · omagari": Conflict alerts, Labels (18px Lucide `tag`)
- **Right side**: parchment background, padding 4px 28px 28px. At the top, the picked item's name (`{typography.app-title}`). The implementation sits right under the 4px top padding at 24px tall, and the first group title follows right under it (we meant to space it with a 60px row, but we leave it as is to match the implementation, 2026-11-16 @Pancheble #139 review). 24px between groups.
  - A group title (13px/600 secondary, padding 0 16px 6px), `{component.app-settings-group}` (white background, `{rounded.md}`, 1px line), and under that a description (12px secondary, padding 6px 16px 0).
  - `{component.app-settings-row}` (min height 52px, padding 10px 16px, 1px line between rows): on the left a name (15px) and a description (13px secondary), on the right the control (switch, picker button, link, badge).
- **`app-switch`** 40×24px, a white 20px handle, off is `{colors.offline}`, on is `{component.app-switch-on}`, 150ms. `role="switch"`, `aria-checked`, and the name and description are tied together with `aria-labelledby` and `aria-describedby`.
- **My agent**:
  - "When others ask": an "Answer other people's questions" switch (on by default, ADR-0024). The description is, when on, "When another member's agent asks, my agent reads my folder and answers.", and when off, "It's off. Whoever asks hears "not accepting" right away." The next row is "What my agent answered" (description "3 times in the last 7 days · the last was calcRefund(), asked by Minsu's Codex", on the right "View history ›" in the accent color). Under the group: "When answering, the runner on my machine only reads my folder, and my usage is used."
  - "Connected agents": one row per agent. The agent mark, the name, "This machine · runner on", and on the right a "Connected" outline badge. For an agent whose runner is off, the mark is dimmed to 50%, "The runner is off", and on the right "Off" (12px secondary).
- **Conflict alerts**:
  - "Forum to post alerts to" is gone (ADR-0039). You create and edit forums on the forum screen ("Create a forum" and the filter row under "Conflict forum").
  - "Merge run" (2026-11-13 draft 30-C. We didn't pick 30-A, which makes a new item, or 30-B, which puts it under My agent): the item's first group. It has no switch. You turn it on and off from the runner, not the web (ADR-0034).
    - "Check command" row: description "The command that runs on the merged result.", on the right the command (13px monospace secondary text, read only). If the repo has no config file, the description is "The repo has no config file. Once you merge one, it starts running.", and on the right "How to set one ›" (accent color).
    - "Run on my runner" row: when on, the description is "It's on. It only runs inside the sandbox." and a "On" outline badge. If you turned it off, "It's off. Verdicts that other members' runners ran still show." and "Off" (12px secondary). If there's no sandbox tool, "This machine has no sandbox tool, so it doesn't run." and "How to install ›" (accent color). If the runner is off, "The runner is off." and "Off".
    - "How to set one" is how to merge `.omagari.json` (`{"check": "<check command>", "setup": "<setup command>"}`) into the default branch, and the way to turn a runner you switched off back on is `omagari runner --merge-check on` (ADR-0034).
    - Description under the group: "It reads from the config file on the repo's default branch. To change it, edit that file and merge it. It's the same for every member. Turning it on and off happens on the runner, not the web, so the server can't decide what runs on my machine."
  - "Workspace": name and repo (13px monospace), read only.
- **Labels** (2026-11-17 draft 51-D4. We didn't pick 51-A, a one-line list, 51-B, two groups for Discuss and FYI, 51-C, where rows expand, 51-E, editing right in the row, 51-F, where expanding shows importance only, or 51-G, which turns the whole settings window into a screen): a 230px list on the left, an edit pane on the right, 20px apart. A label is the repo's GitHub label, and importance exists only in Omagari (ADR-0039).
  - **Left**: at the top, a "Find a label" field (32px tall, white background, 1px line, 14px magnifier) and a 32px `+` button ("New label"). Under that, a `{component.app-settings-item}` row per label: a 10px color dot, the name, and importance at the end of the row ("Discuss" is `{component.app-importance-discuss}`, "FYI" is `{component.app-badge-outline}`). The picked row gets `{colors.selected}` and 600 weight.
  - **Right**: a 1px `{colors.divider}` vertical line on the left, 20px padding on the left inside. From the top:
    1. "Here's how it looks in a post" (`{colors.selected}` box, `{rounded.md}`): the post title and issue number, then the kind badge, this label's `{component.app-label-badge}`, and the importance mark.
    2. The name field and color on one row. The color is a 20px color dot, a six-digit hex field with a `#` in front (monospace), and a 32px "Pick another color" button (Lucide `refresh-cw`). Like GitHub, you set just one color. The dark-mode color is computed from it (the same way GitHub takes label colors as `--label-r/g/b/h/s/l` and computes them per theme. The formula is in Known Gaps).
    3. A description field.
    4. Importance: two radio cards side by side (white background, 1px line, `{rounded.md}`, padding 12px, the picked card gets an accent-color line). "FYI · Stacks up as alerts. Doesn't open an issue." and "Discuss · People look at it and talk it through. Opens a GitHub issue once attached." Under that, "Changing to Discuss opens issues on the 3 open posts with this label." (12px secondary).
    5. At the bottom right, "Reset" (outline) and "Save" (blue background). The name, color, and description also change on the GitHub label, and importance is the same for every member.

#### Buttons

- **`app-button`** 32px tall, `{rounded.pill}`, 14px. The default has a blue background.
- **`app-button-outline`** border only, **`app-button-quiet`** no background (Cancel and the like), **`app-button-danger`** error-color text (Leave and the like), **`app-button-disabled`** secondary text on a chip background.
- Keep one blue-background button per screen.

#### Badges

- **`app-badge`** 20px tall, `{rounded.pill}`, 12px. It has nine uses.
  - Label: `{component.app-label-badge}`. 22px tall, 1px line, text color, an 8px color dot in front (the GitHub label color, with a 1px inner line at 12%). Color is only on the dot, and the screen's accent color is still just one.
  - Importance: Discuss is `{component.app-importance-discuss}` (white text on a text-color background), FYI is `{component.app-badge-outline}`.
  - Visibility: `{component.app-badge-outline}`. It only goes on the header of a Q&A card expanded in a channel. A DM has no visibility badge ("DM pane").
  - Includes in-progress changes: `{component.app-badge-warning}`
  - As of N hours ago: an outline badge with an 11px clock icon in front
  - Model that answered: `{component.app-badge-outline}` with the model and effort, like "Opus · high". If you asked with "Default", use the real model name the executor reported, and if it's unknown, don't add a badge.
  - AI-written answer: `{component.app-badge-ai}` ("Written by AI")
  - Comment that came in from GitHub: `{component.app-badge-outline}` "GitHub" ("Message")
  - Verdict: the verdict badge in the forum list ("Verdict in the list" under "Conflict forum") and "Breaks when merged" on a work row. Only failures get `{component.app-badge-warning}`, and the rest get `{component.app-badge-outline}`

#### Banners

- Right under the channel header band, as wide as the conversation pane. 36px tall, `{rounded.md}`, 13px. The action on the right is underlined text at 600 weight.
  - **`app-banner-info`** info: "Reconnecting to the server…"
  - **`app-banner-warning`** warning: "The Codex runner is off · View settings"
  - **`app-banner-error`** error (`role="alert"`): "Couldn't send the message · Try again"

#### Floating layers

- **`app-popover`** menu. White background, 1px line, the floating layer's shadow, `{rounded.md}`, 6px padding.
- **`app-dialog`** dialog. 400px wide, `{rounded.lg}`, 24px padding, placed in the middle of the screen. The back cover is `{colors.overlay}`. The title (17px/600) on top, and buttons at the bottom right ("Cancel" is a quiet button, the main action is the default button). It closes with Esc and by pressing the cover.
- **`app-tooltip`** tooltip. `{colors.ink}` background, white 12px, `{rounded.xs}`, padding 4px 8px. It shows after 0.5 seconds of hovering. Use it on icon-only buttons. The text is the button's `aria-label`, and showing a shortcut with it (for example "Close channel panel ⌘\") or fields with text in them (the emoji field) is decided separately. It appears 6px below the button (above it if it's at the bottom edge of the window), and shows right away when reached by keyboard. It also shows over dialogs. We don't use the browser's default tooltip (`title`) (#257).

#### States

- **Loading**: `{component.app-skeleton}` gray bars. An avatar-spot circle and two lines (30% and 90% wide), repeated for two or three messages (`aria-busy`).
- **Answering**: the agent mark and "Claude Code is answering…" (13px secondary, `role="status"`).
- **Cut-off answer**: a warning strip "Cut off the answer after 10 minutes · Ask again".
- **Empty state**: a title (15px/600) and a description (13px secondary) in the middle of the panel. For example: "No messages in # payments yet" / "Send the first message, or ask my agent first."
- **Error state**: the same frame as the empty state plus a "Try again" (outline button).

#### Markdown in agent answers

- Body 15px/1.6. Paragraphs, lists, inline code (`{component.app-code-inline}`), and links (accent color, underlined) show as they are.
- **`app-code-block`** parchment, `{rounded.md}`, padding 12px 14px, `{typography.mono}`. It scrolls sideways when long.
- Tables: 13px, header 600, cell padding 6px 10px, a `{colors.divider}` line on every row.
- HTML and scripts in an answer don't run.

## Writing

How screen text sounds. It's plain and Discord-like in both languages (ADR-0045, `docs/stage6-questions.md` Q7).

- **Korean**: 해요체.
- **English**: second person, contractions, sentence case. "Couldn't save that", not "The save operation could not be completed."
- **One thing per line.** Say what happened, or what to do next. Not both in a long sentence.
- **Buttons are one verb.** "Save", "Post", "Remove". Not "Click here to save".
- **No jokes.** Not in errors, empty states, or team stuff.
- **Use glossary names as they are** (`GLOSSARY.md`). Don't swap in synonyms like "bot" for Agent or "user" for Owner.
- **Don't blame the person.** Say what we couldn't do, then what they can try.

Rewrites of text already on screen:

| Before                                       | Korean                                         | English                                           |
| -------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요. | 못 바꿨어요. 조금 있다 다시 해 볼래요?         | Couldn't save that. Try again in a bit?           |
| (비어 있어요)                                | 아직 아무것도 없어요                           | Nothing here yet                                  |
| 네트워크를 확인하고 다시 시도해 주세요.      | 연결이 끊긴 것 같아요. 인터넷을 확인해 볼래요? | Looks like you're offline. Check your connection? |

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
- App: set text people have to read at 11px or larger.
- App: use `{colors.text-secondary}` for secondary text.
- App: tell people and agents apart by shape. People get round avatars and a presence dot, and agents get rounded squares and an executor abbreviation.
- App: don't mix the "status line" that comes with each work (written by the agent) with the "status message" a person sets. A collapsed member row shows the status message, and an expanded one shows the status line.

### Don't

- Don't introduce a second accent color; every "click me" signal is `{colors.primary}` (Action Blue).
- Don't add shadows to cards, buttons, or text — shadow is reserved for product imagery and, in the app, floating layers (menus, dialogs).
- Don't use gradients as decorative backgrounds; atmosphere comes from photography.
- Don't use weight 500 or 700. The ladder is 300 / 400 / 600. Body is always 400; strong inline is 600; display is 600.
- Don't round full-bleed tiles — tiles are rectangular and edge-to-edge; the color change is the divider.
- Don't tighten line-height below 1.47 for body copy — the editorial leading is part of the brand.
- Don't mix radii outside the scale: `{rounded.xs}`, `{rounded.sm}`, `{rounded.md}`, `{rounded.lg}`, `{rounded.pill}` — and nothing in between.
- Don't use `{colors.primary-on-dark}` (Sky Link Blue) on light surfaces — it's the dark-tile-only variant. Action Blue is for light surfaces.
- App: don't give Korean text negative letter-spacing.
- App: don't use company logos or emoji as icons.
- App: don't open the member list and the DM together in the right pane.
- App: don't start with the channel panel collapsed. A first-time user can't find channels.
- App: don't cut a floating menu off at the panel edge, and don't open one on top of text someone is writing.

## Responsive Behavior

### Breakpoints

| Name             | Width       | Key Changes                                                                                               |
| ---------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| Small phone      | ≤ 419px     | Single-column tiles; sub-nav collapses to category name + primary CTA only; hero typography drops to 28px |
| Phone            | 420–640px   | Single-column stack; product renders scale to 80% of tile width; hero h1 drops to 34px                    |
| Large phone      | 641–735px   | Tiles transition to tighter padding (48px vertical vs 80px); fine-print wraps                             |
| Tablet portrait  | 736–833px   | Global nav collapses to hamburger; sub-nav hides category chips, keeps primary CTA                        |
| Tablet landscape | 834–1023px  | Global nav returns fully expanded; 3-column utility grids become 2-column                                 |
| Small desktop    | 1024–1068px | Product tiles use 2/3 width with margin gutters; hero h1 stays at 40px                                    |
| Desktop          | 1069–1440px | Full layout; 4–5 column store grids; 1440px content max                                                   |
| Wide desktop     | ≥ 1441px    | Content locks at 1440px, margins absorb extra width                                                       |

The structural breakpoints that matter for agents: 1440px (content lock), 1068px (small-desktop), 833px (tablet landscape switch), 734px (tablet portrait), 640px (phone), 480px (small phone).

### Touch Targets

- Minimum 44 × 44px. `{component.button-primary}` lands at ~44 × 100px (with the full-pill radius making the visible hit area more generous than the label suggests).
- `{component.button-icon-circular}` is exactly 44 × 44px.
- Global nav utility links are smaller (~32 × 80px) — they deliberately sit at a tighter target because they're precision desktop actions, and the mobile hamburger replaces them at ≤ 833px.
- The app's desktop rows (30px channel rows, 32px header band buttons) are small for the same reason, and they grow to 44px at 833px and below.

### Collapsing Strategy

- **Global nav**: full horizontal link row on desktop → collapses to Apple logo + hamburger + bag icon at 834px and below.
- **Sub-nav**: category name + inline links + primary CTA → category name + primary CTA only at mobile; inline links move into a hamburger tray.
- **Product tiles**: stack from 2-column to 1-column at 834px; vertical padding tightens from 80px → 48px at small-phone.
- **Utility grids** (store, accessories): 5-col → 4-col (1440px) → 3-col (1068px) → 2-col (834px) → 1-col (640px).
- **Hero typography**: `{typography.hero-display}` (56px) → `{typography.display-lg}` (40px) at 1068px → 34px at 640px → 28px at 419px.

### App on narrow screens

| Width           | App frame                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1069px and up   | Three panes (channel panel, conversation, right pane). Collapsing the channel panel leaves two panes, the conversation and the right pane                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 834–1068px      | Two panes, the channel panel and the conversation. The right pane opens over the conversation (320px wide, a floating layer). Collapsing the channel panel leaves just the conversation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 833px and below | Just the conversation. The menu button on the left of the header band opens the channel panel (including the name row, repo picker, and profile) as a left drawer. A post and my agent (DM) open as a full-screen conversation like a channel: no cover, no outer margin, and no rounded corners, with the header band and the input in the same place as a channel's, and the "‹" on the left of the header band goes back to the previous screen. A post's "Expand" is hidden (2026-11-13 @Pancheble). The member list and the full profile view are full-height sheets that come up from the bottom. The profile card, GIF pane, and `:` autocomplete open as sheets that come up from the bottom. Buttons and rows are 44px |

**Header band on narrow screens** (2026-11-18 draft 94-B, #204, #231. We didn't pick 94-A, which hides the description, or 94-C, which drops the description above the search field): at 833px and below, the header band stacks the name and description on two lines.

- The header band is 60px tall. In order: the menu button on the left (44px), the title group in the middle, and the buttons on the right (44px).
- The title group takes all the leftover width and shrinks (`flex: 1; min-width: 0`). The buttons don't shrink (`flex: none`). That way the name, description, and buttons don't overlap.
- The first line is the icon and name (17px/600, ellipsis), and the second line is the description (12px secondary, one line with ellipsis). That's the same for a channel's "N members", a forum's "Omagari posts alerts as posts", and the descriptions of posts and DMs.
- At 834px and up it stays one line like now (52px, name 20px, description 13px). Even then, the description shrinks before the name.

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
- App: there are no components yet for the decision box and decision view (stage 2 Q&A Q9). The screen for the answered history that "View history" opens doesn't exist yet either.
- App: the forum filter draft (53-D, 52) lets you add labels to a group ("All labels whose importance is Discuss") and has "Status" in the filter row. The contract's `ForumFilter` is either one importance or one list of labels, and has no status, so #194 fit the screen to it without widening the contract: turning a group on means you can't pick labels separately (they're locked), and the status chip lives only on the viewer's screen, not in the forum's filter (starts as "Open"). We didn't add "+ Filter" because there's no condition to add. If we want to use groups and labels together, we widen `ForumFilter`.
- App: the drafts have no place to edit and delete a forum, so #194 put a "Edit forum" (Lucide `settings-2`) button in the forum header band, and it opens the same dialog as "Create a forum" (titled "Edit forum", with "Delete forum" at the bottom left, which needs a second press to delete). "Other posts" hides the row when it has 0. For a new label, the `+` in the label item clears the right pane and changes it to "Create". A save failure shows an error text under the right pane. We didn't re-check these three against a draft.
- App: "Posts that involve me" in the channel panel can't use the people who spoke in a post, because the contract doesn't have them. We take it as posts with an alert that touches my work and a last message, or posts where my message is in the conversation I've read on this screen. We miss messages I wrote long ago in a post I haven't opened.
- App: we haven't set the formula for changing label colors on the dark screen. Like stage 1, we only ship the light screen. We also haven't drawn the narrow screens for the stage 4 drafts (51–55).
- App: we haven't drawn a separate narrow-screen verdict strip, and it wraps lines like the decision status strip. The merge run's config file is `.omagari.json` (`check`, `setup`) as drafted, and the option to turn it off on the runner is `omagari runner --merge-check off` (ADR-0034, #127).
- App: the preview of conflicting lines in the forum's card view comes later (2026-11-13 @Pancheble dropped it from stage 2). The alert only has line numbers, and to carry the line content, the runner needs a contract change that sends content at the share level (ADR-0007). The card view isn't the default view either. The spec for when we add it: top of the card, 12px monospace, line height 1.55, padding 14px 16px. For a direct conflict, two people's lines in `{colors.warning}` on a `{colors.warning-bg}` background, and for a definition line change, two -/+ lines on a `{colors.selected}` background.
- App: things we didn't draw in the debate (2026-11-17 drafts 56–60): the auto-join switch (a row in the settings window next to the ask switch, ADR-0024), stance cards in the expanded view and on narrow screens, the dark screen, the look of an expanded experiment patch and output, how the conversation looks on a post whose debate ended after 14 days, what happens when starting a stand-in fails, and a mark in the forum list and sidebar that points at a post in debate. Also, an option's owner and the stand-in mark are covered like a spoiler while picking (draft 61). Read the implementation doc's chapter 7, which only says "a stand-in mark goes on a statement", in line with this.
- App: the debate draft's waiting strip uses Park Minsu's name only in the first round. In later rounds, naming who's being waited on in the strip would reveal the owner of an option number, so we decided to write only "stance 1/2" with no name (the draft only drew the first round).
- App: where the screen differs from the spec above because the contract has no information (2026-11-18 @Pancheble: follow the implementation until we widen the contract, #257). To widen it, make a separate issue that bumps `CONTRACT_VERSION`.
  - The debate's owner mark and the conclusion card: a stance's owner has no executor, so it's "Choi Hajun's agent" instead of "Choi Hajun's Claude Code", and the conclusion card's description is "Option 1 came from Choi Hajun's agent (feat/mail-queue). Press Wrap up the decision and my agent writes a decision draft based on Option 1."
  - The Omagari line for calling a stand-in has no time (the stand-in has no call time). A failed experiment line carries no output, so it's "View patch" instead of "View output", and the debate strip doesn't have the "Running an experiment" state yet. The description for opening a debate has no issue number.
  - The settings' connected agents don't know which machine it is, so it's "Runner on" ("Runner on · answering") instead of "This machine · runner on", and "What my agent answered" is "Minsu's agent asked “…”" instead of the asker's executor.
  - The input placeholder in an expanded post is the post title ("Send a message to refund's reason field") instead of the conflicting file (the title became the issue title in ADR-0032).
- App: when executors increase, add their abbreviations for `app-agent-mark` here (right now `CC` and `CX`).
- App: what we haven't decided from the workspace and repo drafts (89–94, #231): what to do with the channels and posts of a repo that was removed, how the add-repo list looks when there's no repo to add and how a workspace with no repos at all looks, workspace posts that span repos (ADR-0043 pushed it until after dogfooding), and the dark screen.
- App: properties used on components like `borderColor`, `iconColor`, `shadow`, `backdropFilter`, and `maxWidth`, and pointing at single text values (`fontSize` and so on), show up as "unknown property" warnings in the design.md spec checker. They're warnings, not errors, and we write them this way so the gstack checker can resolve every reference.
