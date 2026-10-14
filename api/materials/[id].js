// /api/materials/:id: the instructor materials zone is closed to every login.
import { closedMaterials } from '../../src/notes-server.mjs';

export default function handler(request, response) {
  return closedMaterials(request, response, '/api/materials/:id');
}
