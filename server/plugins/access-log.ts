import {
  getMethod,
  getRequestURL,
  getResponseStatus,
} from 'h3'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    event.context._startTime = Date.now()
  })

  nitroApp.hooks.hook('afterResponse', (event) => {
    const duration = Date.now() - (event.context._startTime || Date.now())
    const method = getMethod(event)
    const url = getRequestURL(event)
    const status = getResponseStatus(event)

    const path = /^\/(?:api\/auth\/oauth2|api\/mcp|mcp)(?:\/|$)/.test(url.pathname) ? url.pathname : url.pathname + url.search
    console.log(`[access] ${method} ${path} ${status} ${duration}ms`)
  })

  nitroApp.hooks.hook('error', (error, { event }) => {
    const duration = event
      ? Date.now() - (event.context?._startTime || Date.now())
      : 0
    const method = event ? getMethod(event) : '-'
    const rawPath = event?.path || '-'
    const path = /^\/(?:api\/auth\/oauth2|api\/mcp|mcp)(?:\/|\?|$)/.test(rawPath) ? rawPath.split('?')[0] : rawPath
    const status = (error as { statusCode?: number }).statusCode || 500

    console.error(`[access] ${method} ${path} ${status} ${duration}ms - ${error.message}`)
  })
})
