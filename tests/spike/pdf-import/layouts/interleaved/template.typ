// Caso límite del spike (T-8.4, corpus C): columnas entrelazadas a propósito. Cada experiencia reparte sus logros
// entre dos columnas (pares a la izquierda, impares a la derecha) y las secciones también van alternando, de modo que
// el orden de lectura del texto extraído no coincide con el del CV. Mismo contrato cv(d, theme).
#let run(r) = {
  let body = if r.code { raw(r.text) } else { r.text }
  if r.bold { body = strong(body) }
  if r.italic { body = emph(body) }
  body
}
#let runs(rs) = rs.map(run).join()

#let cv(d, theme) = {
  set page(paper: "a4", margin: 15mm)
  set text(font: "Source Sans 3", size: 9.5pt, lang: d.lang)
  text(size: 20pt, weight: "bold")[#d.fullName]
  linebreak()
  if d.contact.len() > 0 { runs(d.contact); linebreak() }
  v(4pt)
  heading(level: 2)[Experiencia]
  for item in d.experience {
    let left = ()
    let right = ()
    let index = 0
    for a in item.achievements {
      let piece = list.item(runs(a.runs))
      if calc.rem(index, 2) == 0 { left.push(piece) } else { right.push(piece) }
      index += 1
    }
    grid(
      columns: (1fr, 1fr),
      column-gutter: 10pt,
      { text(weight: "bold")[#item.role · #item.company]; linebreak(); text(size: 8.5pt)[#item.period]; left.join() },
      { text(size: 8.5pt)[#item.at("location", default: "")]; linebreak(); right.join() },
    )
    v(3pt)
  }
  grid(
    columns: (1fr, 1fr),
    column-gutter: 10pt,
    { heading(level: 2)[Formación]; for e in d.education { [#e.degree · #e.institution · #e.period \ ] } },
    { heading(level: 2)[Habilidades]; for g in d.skillGroups { [#g.label: #g.names \ ] } },
  )
}
