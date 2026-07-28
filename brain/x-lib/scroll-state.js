(() => JSON.stringify({
  atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 200,
  spinner: !!document.querySelector('[role="progressbar"]'),
}))()
