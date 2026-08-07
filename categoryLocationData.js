// ABOUTME: Freezr data access for user-managed category and location references.
// ABOUTME: Keeps server queries index-friendly; sorting and filtering happen in app logic.

export const listCategories = () => freezr.query('categories', {}, { sort: { _date_modified: -1 } })
export const createCategory = (data, options = {}) => options.dataObjectId
  ? freezr.create('categories', data, {
      data_object_id: options.dataObjectId,
      upsert: options.upsert === true
    })
  : freezr.create('categories', data)
export const updateCategory = (id, fields) => freezr.updateFields('categories', id, fields)

export const listLocations = () => freezr.query('locations', {}, { sort: { _date_modified: -1 } })
export const createLocation = data => freezr.create('locations', data)
export const updateLocation = (id, fields) => freezr.updateFields('locations', id, fields)
