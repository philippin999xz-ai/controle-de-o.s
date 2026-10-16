import { useState, Fragment } from "react";
import Linha from "./Linha.jsx";
import Icon from "./Icon.jsx";
export default function OrdersTable({ items, onEdit, onDel, onCreate }) {
  const [open, setOpen] = useState(null);
  if (!items.length)
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <Icon name="orders" size={30} />
        </span>
        <h3>Nenhuma ordem por aqui</h3>
        <p>
          Cadastre uma O.S. ou ajuste os filtros para encontrar seus registros.
        </p>
        <button onClick={onCreate}>
          <Icon name="plus" size={17} /> Cadastrar ordem
        </button>
      </div>
    );
  return (
    <div className="table-scroll" role="region" aria-label="Tabela de ordens de serviço" tabIndex={0}>
      <table className="orders-table">
        <thead>
          <tr>
            <th scope="col">Ordem de serviço</th>
            <th scope="col">Equipamento</th>
            <th scope="col">Serviço solicitado</th>
            <th scope="col">Executante</th>
            <th scope="col">Manutenção</th>
            <th scope="col">Registro</th>
            <th scope="col">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <Fragment key={r.id}>
              <tr>
                <td>
                  <button
                    className="order-link"
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                    aria-expanded={open === r.id}
                  >
                    #{r.numero_os || "Sem número"}
                  </button>
                </td>
                <td className="equipment">{r.equipamento || "—"}</td>
                <td className="service-cell" title={r.servico_solicitado}>
                  {r.servico_solicitado || "—"}
                </td>
                <td>{r.executante || "—"}</td>
                <td>
                  <span
                    className={
                      "type-tag " +
                      ({
                        Corretiva: "corrective",
                        Preventiva: "preventive",
                        Preditiva: "predictive",
                      }[r.tipo_manutencao] || "")
                    }
                  >
                    {r.tipo_manutencao || "Não informado"}
                  </span>
                </td>
                <td className="date-cell">
                  {r.criado && !isNaN(Date.parse(r.criado))
                    ? new Date(r.criado).toLocaleDateString("pt-BR")
                    : "—"}
                </td>
                <td>
                  <button
                    className="table-edit"
                    onClick={() => onEdit(r)}
                    aria-label={"Editar OS " + (r.numero_os || "sem número")}
                  >
                    Editar
                  </button>
                </td>
              </tr>
              {open === r.id && (
                <tr className="detail-row">
                  <td colSpan={7}>
                    <Linha r={r} onEdit={onEdit} onDel={onDel} />
                    {r.observacoes && <p><strong>Observações:</strong> {r.observacoes}</p>}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
