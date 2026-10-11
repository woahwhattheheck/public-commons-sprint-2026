"""MIT. Real standard-library merchant transforms; replace with your own data work."""
import csv
import io
import statistics


def summarize(input):
    """Typed JSON POST -> a usable distribution summary and rolling mean."""
    values = input['values']
    window = input['window']
    total = 0.0
    rolling = []
    for index, value in enumerate(values):
        total += value
        if index >= window:
            total -= values[index - window]
        rolling.append(total / min(index + 1, window))
    return {
        'count': len(values), 'minimum': min(values), 'maximum': max(values),
        'mean': statistics.fmean(values), 'median': statistics.median(values),
        'populationStdDev': statistics.pstdev(values), 'rollingMean': rolling,
    }


def amortize(input):
    """Typed query -> a CSV calculation. No external data, account, or transaction."""
    principal, annual_rate, periods = input['principal'], input['annual_rate'], input['periods']
    rate = annual_rate / 1200
    payment = principal / periods if rate == 0 else principal * rate / (1 - (1 + rate) ** -periods)
    output = io.StringIO(newline='')
    writer = csv.writer(output, lineterminator='\n')
    writer.writerow(['period', 'payment', 'principal', 'interest', 'balance'])
    balance = principal
    for month in range(1, periods + 1):
        interest = balance * rate
        principal_paid = min(balance, payment - interest)
        balance = max(0, balance - principal_paid)
        writer.writerow([month, f'{principal_paid + interest:.2f}', f'{principal_paid:.2f}', f'{interest:.2f}', f'{balance:.2f}'])
    return output.getvalue().encode('utf-8')
