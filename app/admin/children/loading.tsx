export default function ChildrenLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ height: '1.5rem', width: '8rem', background: '#e2e8f0', borderRadius: '999px', marginBottom: '0.4rem' }} />
          <div style={{ height: '0.875rem', width: '12rem', background: '#f1f5f9', borderRadius: '999px' }} />
        </div>
        <div style={{ height: '2.25rem', width: '7rem', background: '#e2e8f0', borderRadius: '0.75rem' }} />
      </div>
      {[1, 2].map(i => (
        <div key={i} style={{ background: 'white', borderRadius: '1rem', overflow: 'hidden', border: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem 1.5rem' }}>
            <div style={{ width: '52px', height: '52px', background: '#f1f5f9', borderRadius: '50%' }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: '1.1rem', width: '6rem', background: '#e2e8f0', borderRadius: '999px', marginBottom: '0.4rem' }} />
              <div style={{ height: '0.75rem', width: '9rem', background: '#f1f5f9', borderRadius: '999px' }} />
            </div>
            <div style={{ height: '1.5rem', width: '4rem', background: '#f1f5f9', borderRadius: '999px' }} />
          </div>
          <div style={{ display: 'flex', borderTop: '1px solid #f1f5f9' }}>
            {[1, 2, 3, 4].map(j => (
              <div key={j} style={{ flex: 1, height: '2.75rem', background: '#fafafa', borderRight: j < 4 ? '1px solid #f1f5f9' : 'none' }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
