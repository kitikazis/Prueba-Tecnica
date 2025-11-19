import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-correo-registro',
  standalone: true,
  // Importante: Agregamos CommonModule y ReactiveFormsModule
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './correo-registro.html',
  styleUrl: './correo-registro.css',
})
export class CorreoRegistro {
  // --- INYECCIÓN DE DEPENDENCIAS ---
  private fb = inject(FormBuilder);
  private router = inject(Router);

  // --- SIGNALS (Para mostrar/ocultar contraseñas) ---
  showPassword = signal(false);
  showConfirmPassword = signal(false);

  // --- FORMULARIO ---
  correoForm: FormGroup = this.fb.group(
    {
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      terms: [false, Validators.requiredTrue], // El toggle debe estar activo (True)
    },
    { validators: this.passwordMatchValidator }
  ); // Validar que coincidan

  // --- VALIDADOR PERSONALIZADO ---
  // Compara 'password' con 'confirmPassword'
  passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password');
    const confirm = control.get('confirmPassword');

    if (!password || !confirm) return null;

    // Si no coinciden, retornamos error { mismatch: true }
    return password.value === confirm.value ? null : { mismatch: true };
  }

  // --- MÉTODOS VISUALES ---
  togglePassword() {
    this.showPassword.update((value) => !value);
  }

  toggleConfirm() {
    this.showConfirmPassword.update((value) => !value);
  }

  // --- ACCIONES ---
  onSubmit() {
    if (this.correoForm.valid) {
      console.log('REGISTRO COMPLETADO:', this.correoForm.value);
      alert('¡Registro exitoso! Bienvenido a LaFija.');
      // Aquí redirigirías al Login o al Home del usuario
      // this.router.navigate(['/dashboard']);
    } else {
      this.correoForm.markAllAsTouched(); // Muestra los errores en rojo
    }
  }

  goBack() {
    // Vuelve al paso 1 (ajusta la ruta si tu paso 1 tiene otra URL)
    this.router.navigate(['/registro']);
  }
}
