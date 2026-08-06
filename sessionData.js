export const createSession = (data) => freezr.create('sessions', data)

export const updateSession = (id, fields) => freezr.updateFields('sessions', id, fields)