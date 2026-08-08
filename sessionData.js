export const createSession = (data) => freezr.create('sessions', data)

export const updateSession = (id, fields) => freezr.updateFields('sessions', id, fields)

export const listAllSessions = () => freezr.query('sessions', {}, { sort: { _date_modified: -1 } })

export const getSessionById = async id =>
  (await listAllSessions()).find(session => session._id === id) || null

export const listUnfinishedSessions = async () =>
  (await listAllSessions()).filter(session =>
    session.status === 'active' || session.status === 'paused'
  )
