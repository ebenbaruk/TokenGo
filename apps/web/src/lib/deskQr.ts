// QR du panneau « ordinateur » (index.html) : même origine, sans ?k= (le pass juge ne doit pas fuiter sur un écran partagé).
import qrcode from 'qrcode-generator';

export function mountDeskQr(): void {
  const box = document.querySelector<HTMLElement>('.desk-qr');
  const slot = box?.querySelector<HTMLElement>('.desk-qr-code');
  if (!box || !slot) return;
  const qr = qrcode(0, 'M');
  qr.addData(`${location.origin}/`);
  qr.make();
  slot.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  box.hidden = false;
}
