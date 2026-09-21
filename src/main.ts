import * as THREE from 'three';
import { App } from './App';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
const overlay = document.querySelector<HTMLElement>('#overlay');

if (!canvas || !overlay) {
  throw new Error('Missing #viewport canvas or #overlay container in index.html');
}

const app = new App(canvas, overlay);
app.start();

// Handy while developing: inspect the live scene from the browser console.
Object.assign(globalThis, { app, THREE });
