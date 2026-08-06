const VIEWS = ['tasks', 'session', 'doing', 'review']

export function showView(name) {
  VIEWS.forEach(v => {
    document.getElementById('view-' + v).style.display = v === name ? 'block' : 'none'
    document.querySelector('.nav-btn[data-view="' + v + '"]').classList.toggle('active', v === name)
  })
}

export function setNavVisible(name, visible) {
  const btn = document.querySelector('.nav-btn[data-view="' + name + '"]')
  if (btn) btn.style.display = visible ? 'inline-block' : 'none'
}