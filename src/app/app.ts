import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css', // Puedes dejar el CSS global aquí si quieres
})
export class App {
  // Aquí ya no va ninguna lógica
}
