export default function DashboardLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{
        background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
        borderRadius: '1.5rem', padding: '2rem', textAlign: 'center',
      }}>
        <div style={{ height: '1rem', width: '6rem', background: 'rgba(255,255,255,0.3)', borderRadius: '999px', margin: '0 auto 0.75rem' }} />
        <div style={{ height: '3.5rem', width: '10rem', background: 'rgba(255,255,255,0.3)', borderRadius: '0.75rem', margin: '0 auto' }} />
      </div>
      <div style={{ background: 'white', borderRadius: '1.25rem', padding: '1.5rem' }}>
        <div style={{ height: '1.1rem', width: '10rem', background: '#f1f5f9', borderRadius: '999px', marginBottom: '1rem' }} />
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ display: 'flex', gap: '0.75rem', padding: '0.875rem 0', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ width: '40px', height: '40px', background: '#f1f5f9', borderRadius: '50%', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: '0.75rem', width: '5rem', background: '#f1f5f9', borderRadius: '999px', marginBottom: '0.4rem' }} />
              <div style={{ height: '0.75rem', width: '8rem', background: '#f1f5f9', borderRadius: '999px' }} />
            </div>
            <div style={{ width: '3rem', height: '1rem', background: '#f1f5f9', borderRadius: '999px' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
