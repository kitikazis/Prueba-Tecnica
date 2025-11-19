import { Routes } from '@angular/router';
import { ClienteRegistro } from './cliente-registro/cliente-registro';
import { CorreoRegistro } from './correo-registro/correo-registro';
import { Home } from './Home/home';

export const routes: Routes = [
  {
    path: 'home',
    component: Home,
  },
  {
    path: 'registro',
    component: ClienteRegistro,
  },

  {
    path: 'correo',
    component: CorreoRegistro,
  },
];
