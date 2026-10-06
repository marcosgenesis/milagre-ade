const { randomUUID } = require('node:crypto');
const { validLinkId } = require('@milagre/shared/chat-scopes');

function validProjectGroup(group) {
  return group && validLinkId(group.id) && typeof group.name === 'string' && group.name.trim().length > 0
    && Array.isArray(group.projectIds) && group.projectIds.length >= 2
    && group.projectIds.every(id => typeof id === 'string') && new Set(group.projectIds).size === group.projectIds.length;
}

function createProjectGroup(groups, projects, request, now = () => new Date()) {
  const name = typeof request?.name === 'string' ? request.name.trim() : '';
  if (!name || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new Error('Give the Link a name of 1 to 100 characters.');
  const ids = request?.projectIds;
  if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length) throw new Error('Choose at least two distinct Projects.');
  if (ids.some(id => typeof id !== 'string' || !projects.some(project => project.id === id))) throw new Error('Open each member Project in Milagre first.');
  if (groups.some(group => group.projectIds.length === ids.length && ids.every(id => group.projectIds.includes(id)))) throw new Error('A Link with these Projects already exists.');
  return { id: randomUUID(), name, projectIds: [...ids], createdAt: now().toISOString() };
}

module.exports = { validProjectGroup, createProjectGroup };
