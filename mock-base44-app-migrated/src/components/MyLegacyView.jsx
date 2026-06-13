import React from 'react';
import { Button } from './Button';

export default function MyLegacyView() {
  return (
    <div className="modernized-view">
      <h2>Legacy View Content</h2>
      <Button onClick={() => alert('Clicked')}>Action</Button>
    </div>
  );
}
