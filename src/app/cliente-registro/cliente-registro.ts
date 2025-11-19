import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-cliente-registro',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './cliente-registro.html',
  styleUrl: './cliente-registro.css',
})
export class ClienteRegistro implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);

  registroForm!: FormGroup;

  // Datos para los Selects
  years: number[] = [];
  months = [
    { val: '01', name: 'Ene' },
    { val: '02', name: 'Feb' },
    { val: '03', name: 'Mar' },
    { val: '04', name: 'Abr' },
    { val: '05', name: 'May' },
    { val: '06', name: 'Jun' },
    { val: '07', name: 'Jul' },
    { val: '08', name: 'Ago' },
    { val: '09', name: 'Sep' },
    { val: '10', name: 'Oct' },
    { val: '11', name: 'Nov' },
    { val: '12', name: 'Dic' },
  ];
  days: number[] = [];

  ngOnInit() {
    this.initForm();
    this.generateYears();
    this.generateDays(1, 2000);
  }

  initForm() {
    this.registroForm = this.fb.group({
      docType: ['DNI', Validators.required],
      docNumber: ['', [Validators.required, Validators.pattern(/^[0-9]{8,12}$/)]],
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      birthYear: ['', Validators.required],
      birthMonth: ['', Validators.required],
      birthDay: ['', Validators.required],
      department: ['', Validators.required],
      province: ['', Validators.required],
      district: ['', Validators.required],
      phoneCode: ['+51'],
      phoneNumber: ['', [Validators.required, Validators.pattern(/^[0-9]{9}$/)]],
      gender: ['', Validators.required],
    });

    this.registroForm.get('birthMonth')?.valueChanges.subscribe(() => this.updateDays());
    this.registroForm.get('birthYear')?.valueChanges.subscribe(() => this.updateDays());
  }

  generateYears() {
    const currentYear = new Date().getFullYear();
    for (let i = 0; i < 80; i++) {
      this.years.push(currentYear - 18 - i);
    }
  }

  generateDays(month: number, year: number) {
    this.days = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) {
      this.days.push(i);
    }
  }

  updateDays() {
    const m = Number(this.registroForm.get('birthMonth')?.value);
    const y = Number(this.registroForm.get('birthYear')?.value);
    if (m && y) this.generateDays(m, y);
  }

  // --- AQUÍ ESTÁ EL CAMBIO IMPORTANTE ---
  onSubmit() {
    if (this.registroForm.valid) {
      // Navega a la siguiente pantalla
      this.router.navigate(['/correo']);
    } else {
      this.registroForm.markAllAsTouched();
    }
  }

  goHome() {
    this.router.navigate(['/']);
  }
}
