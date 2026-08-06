export const createSession = (data) => freezr.create('sessions', data)

export const updateSession = (id, fields) => freezr.updateFields('sessions', id, fields)

export const listAllSessions = () => freezr.query('sessions', {}, { sort: { _date_modified: -1 } })
