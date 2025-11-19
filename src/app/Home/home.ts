import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

// Definimos la estructura de los datos
interface BonusOption {
  id: number;
  title: string;
  subtitle: string;
  icon?: string;
  type: 'casino' | 'sports' | 'none';
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule], // Importante para que funcione el HTML
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  // Inyectamos el Router
  private router = inject(Router);

  // Signal para controlar la selección visual
  selectedBonus = signal<number>(1);

  // Datos de los bonos
  bonuses: BonusOption[] = [
    {
      id: 1,
      title: '100 Giros gratis',
      subtitle: 'Para Casino',
      icon: '🎰',
      type: 'casino',
    },
    {
      id: 2,
      title: 'Apuesta gratis S/30',
      subtitle: 'Para Deportes',
      icon: '🏆',
      type: 'sports',
    },
    {
      id: 3,
      title: 'Sin bono',
      subtitle: 'Escríbenos si cambias de opinión',
      icon: '',
      type: 'none',
    },
  ];

  // Función 1: Solo selecciona visualmente (borde verde)
  selectBonus(id: number) {
    this.selectedBonus.set(id);
  }

  // Función 2: Navega a la ruta de registro
  irAlRegistro() {
    this.router.navigate(['/registro']);
  }
}
